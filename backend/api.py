from fastapi import FastAPI, File, UploadFile, HTTPException, Depends, status, Response, BackgroundTasks
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import os
import re
from datetime import datetime, timedelta
import json as json_mod
import hashlib
import math
import random
import shutil
import secrets
import asyncio
import logging
import time
import sys
import sqlite3
import tempfile
import subprocess
from collections import Counter, defaultdict

from backend.auth.utils import get_current_user
from backend.db.mongo import get_db
from backend.auth.routes import router as auth_router

try:
    import openai
except ImportError:
    openai = None

try:
    import httpx
except ImportError:
    httpx = None

try:
    from backend.endeavor_rag_service import (
        interview_rag_pipeline as _real_interview_rag_pipeline,
        get_rag_collection as _real_get_rag_collection,
    )
except Exception:
    _real_interview_rag_pipeline = None
    _real_get_rag_collection = None


def interview_rag_pipeline(*a, **kw):
    """
    Use the real resume RAG pipeline when available.
    Keep a deterministic fallback so /upload-resume does not crash on import issues.
    """
    if _real_interview_rag_pipeline is not None:
        return _real_interview_rag_pipeline(*a, **kw)
    return {"questions": [], "skills": [], "experience": "", "questionsSource": "resume-import-fallback"}


def get_rag_collection():
    if _real_get_rag_collection is not None:
        return _real_get_rag_collection()
    db = get_db()
    return db["resume_question_cache"]

logger = logging.getLogger(__name__)


class ProviderStats:
    """Tracks provider costs, failures, successes and simple circuit-breaker state."""
    def __init__(self):
        self.stats = {
            "gemini": {"cost_per_1m": 0.075, "failures": 0, "successes": 0, "last_failure": None, "blocked_until": None},
            "claude": {"cost_per_1m": 0.80, "failures": 0, "successes": 0, "last_failure": None, "blocked_until": None},
            "openai": {"cost_per_1m": 0.30, "failures": 0, "successes": 0, "last_failure": None, "blocked_until": None},
            "deepseek": {"cost_per_1m": 0.20, "failures": 0, "successes": 0, "last_failure": None, "blocked_until": None},
        }

    def record_success(self, provider: str):
        if provider in self.stats:
            self.stats[provider]["successes"] += 1
            self.stats[provider]["failures"] = max(0, self.stats[provider]["failures"] - 1)

    def record_failure(self, provider: str):
        if provider in self.stats:
            self.stats[provider]["failures"] += 1
            self.stats[provider]["last_failure"] = datetime.now()
            if self.stats[provider]["failures"] >= 3:
                self.stats[provider]["blocked_until"] = datetime.now() + timedelta(minutes=2)

    def is_available(self, provider: str) -> bool:
        if provider not in self.stats:
            return False
        blocked_until = self.stats[provider]["blocked_until"]
        if blocked_until and datetime.now() < blocked_until:
            return False
        return True

    def get_available_providers(self) -> List[tuple]:
        """Return available providers sorted by cost (cheapest first)"""
        available = [
            (provider, data["cost_per_1m"]) 
            for provider, data in self.stats.items()
            if self.is_available(provider)
        ]
        return sorted(available, key=lambda x: x[1])


provider_stats = ProviderStats()


# --- Multi-Provider AI Fallback & JSON Helpers ---

def parse_json_response(raw_text: str) -> Optional[dict]:
    """Parse JSON from LLM response, handling markdown fences and raw text."""
    if not raw_text:
        return None
    try:
        return json_mod.loads(raw_text)
    except Exception:
        pass
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw_text, re.S)
    if m:
        try:
            return json_mod.loads(m.group(1))
        except Exception:
            pass
    start = raw_text.find("{")
    end = raw_text.rfind("}")
    if start != -1 and end > start:
        try:
            return json_mod.loads(raw_text[start:end + 1])
        except Exception:
            pass
    return None


async def _call_single_provider(
    provider: str,
    messages: List[Dict[str, str]],
    temperature: float,
    max_tokens: int
) -> str:
    """Call a single AI provider"""
    if provider == "gemini":
        google_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
        if not google_key:
            raise ValueError("Gemini API key not configured")
        import google.generativeai as genai  # type: ignore  # pyright: ignore
        genai.configure(api_key=google_key)  # type: ignore  # pyright: ignore
        model = genai.GenerativeModel(os.getenv("GOOGLE_MODEL", "gemini-2.0-flash"))  # type: ignore  # pyright: ignore
        prompt_text = "\n\n".join(m["content"] for m in messages if m["role"] != "system")
        try:
            resp = await run_in_threadpool(
                lambda: model.generate_content(prompt_text, generation_config={"temperature": temperature, "max_output_tokens": max_tokens})
            )
            return resp.text or ""  # type: ignore  # pyright: ignore
        except Exception as e:
            # Check for Gemini quota/429 error and raise special exception
            if "quota" in str(e).lower() or "429" in str(e):
                raise RuntimeError("Gemini quota exceeded (429)")
            raise
    elif provider == "claude":
        import anthropic  # type: ignore  # pyright: ignore
        anthropic_key = os.getenv("ANTHROPIC_API_KEY")
        if not anthropic_key:
            raise ValueError("Anthropic API key not configured")
        acl = anthropic.Anthropic(api_key=anthropic_key)
        user_msgs: Any = [{"role": m["role"], "content": m["content"]} for m in messages if m["role"] != "system"]
        try:
            resp_claude: Any = await run_in_threadpool(  # pyright: ignore
                lambda: acl.messages.create(model=os.getenv("ANTHROPIC_MODEL", "claude-3-haiku-20240307"), max_tokens=max_tokens, messages=user_msgs)  # pyright: ignore
            )
            # Safely extract text from the first content block
            block = resp_claude.content[0] if resp_claude.content else None  # pyright: ignore
            return getattr(block, "text", "") or ""  # pyright: ignore
        except Exception as e:
            # Check for Claude quota/429 error and raise special exception
            if "quota" in str(e).lower() or "429" in str(e):
                raise RuntimeError("Claude quota exceeded (429)")
            raise
    elif provider == "openai":
        openai_key = os.getenv("OPENAI_API_KEY")
        if not openai_key:
            raise ValueError("OpenAI API key not configured")
        if openai is None or not hasattr(openai, "OpenAI"):
            raise ImportError("openai package is not installed or OpenAI class missing")
        client = openai.OpenAI(api_key=openai_key)
        try:
            resp = await run_in_threadpool(
                lambda: client.chat.completions.create(model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"), messages=messages, temperature=temperature, max_tokens=max_tokens)  # type: ignore
            )
            return resp.choices[0].message.content or ""
        except Exception as e:
            # Check for OpenAI quota/429 error and raise special exception
            if "quota" in str(e).lower() or "429" in str(e):
                raise RuntimeError("OpenAI quota exceeded (429)")
            raise
    elif provider == "deepseek":
        deepseek_key = os.getenv("DEEPSEEK_API_KEY")
        if not deepseek_key:
            raise ValueError("DeepSeek API key not configured")
        if httpx is None:
            raise ImportError("httpx package is required for DeepSeek")

        model_name = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
        payload = {
            "model": model_name,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=10.0)) as client:
                resp = await client.post(
                    "https://api.deepseek.com/chat/completions",
                    headers={
                        "Authorization": f"Bearer {deepseek_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
            if resp.status_code == 429:
                raise RuntimeError("DeepSeek quota exceeded (429)")
            if resp.status_code >= 400:
                raise RuntimeError(f"DeepSeek HTTP {resp.status_code}: {resp.text[:120]}")
            data = resp.json()
            return (((data.get("choices") or [{}])[0]).get("message") or {}).get("content", "") or ""
        except Exception as e:
            if "quota" in str(e).lower() or "429" in str(e):
                raise RuntimeError("DeepSeek quota exceeded (429)")
            raise
    else:
        raise ValueError(f"Unknown provider: {provider}")


async def call_ai_with_fallback(
    messages: List[Dict[str, str]],
    temperature: float = 0.7,
    max_tokens: int = 4000,
) -> tuple:
    """
    Cost-aware AI routing (Approach 1A): Try cheapest first (Gemini $0.075)
    Parallel fallback (Approach 1C): If >5s, parallel timeout to 2nd cheapest
    Circuit breaker (Approach 1B): Block failing providers for 2min
    Returns (raw_text: str, provider: str)
    """
    errors = []
    available = provider_stats.get_available_providers()
    
    if not available:
        logger.error("All AI providers blocked by circuit breaker")
        raise HTTPException(status_code=503, detail="All AI providers temporarily unavailable")
    
    primary_provider, primary_cost = available[0]
    
    async def run_provider(prov: str):
        try:
            result = await _call_single_provider(prov, messages, temperature, max_tokens)
            provider_stats.record_success(prov)
            logger.info(f"AI from {prov} (${provider_stats.stats[prov]['cost_per_1m']:.3f}/1M tokens)")
            return result, prov
        except RuntimeError as e:
            # Special case: Gemini quota exceeded, try next provider instantly
            if "gemini quota exceeded" in str(e).lower():
                errors.append(f"{prov}: {str(e)[:50]}")
                raise e
            provider_stats.record_failure(prov)
            errors.append(f"{prov}: {str(e)[:50]}")
            raise
        except Exception as e:
            provider_stats.record_failure(prov)
            errors.append(f"{prov}: {str(e)[:50]}")
            raise
    
    try:
        # Primary provider with 5s timeout before parallel fallback
        try:
            result, provider = await asyncio.wait_for(run_provider(primary_provider), timeout=5)
            return result, provider
        except RuntimeError as e:
            # If any provider quota exceeded, try next provider instantly
            err_str = str(e).lower()
            if ("quota exceeded" in err_str or "429" in err_str) and len(available) > 1:
                fallback_provider = available[1][0]
                try:
                    result, provider = await asyncio.wait_for(run_provider(fallback_provider), timeout=15)
                    return result, provider
                except Exception:
                    pass
            raise HTTPException(status_code=503, detail="All AI providers failed or quota exceeded")
        except asyncio.TimeoutError:
            logger.warning(f"{primary_provider} timed out (5s), starting parallel fallback")
            # Try secondary provider if available
            if len(available) > 1:
                fallback_provider = available[1][0]
                try:
                    result, provider = await asyncio.wait_for(run_provider(fallback_provider), timeout=15)
                    return result, provider
                except Exception:
                    pass
            raise HTTPException(status_code=503, detail="All AI providers failed or timed out")
    except HTTPException:
        raise
    except Exception:
        error_msg = "; ".join(errors)[:100] if errors else "Unknown error"
        logger.error(f"AI provider failure: {error_msg}")
        raise HTTPException(status_code=503, detail=f"AI services unavailable: {error_msg}")


async def call_ai_parallel(
    messages: List[Dict[str, str]],
    temperature: float = 0.7,
    max_tokens: int = 2000,
    providers: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Run multiple providers in parallel.
    Returns:
      {
        "successes": [{"provider": str, "raw_text": str}, ...],
        "failures": [{"provider": str, "error": str}, ...]
      }
    """
    available = [p for p, _ in provider_stats.get_available_providers()]
    if providers:
        allowed = {p.strip().lower() for p in providers}
        available = [p for p in available if p in allowed]

    if not available:
        return {"successes": [], "failures": [{"provider": "none", "error": "No providers available"}]}

    async def _run_one(provider: str) -> Dict[str, str]:
        try:
            raw = await _call_single_provider(provider, messages, temperature, max_tokens)
            provider_stats.record_success(provider)
            return {"provider": provider, "raw_text": raw}
        except Exception as e:
            provider_stats.record_failure(provider)
            return {"provider": provider, "error": str(e)[:200]}

    results = await asyncio.gather(*[_run_one(p) for p in available])
    successes: List[Dict[str, str]] = []
    failures: List[Dict[str, str]] = []
    for r in results:
        if r.get("raw_text"):
            successes.append({"provider": r["provider"], "raw_text": r["raw_text"]})
        else:
            failures.append({"provider": r.get("provider", "unknown"), "error": r.get("error", "unknown error")})

    return {"successes": successes, "failures": failures}


def _extract_questions_from_ai_payload(
    parsed: Dict[str, Any],
    topic: str,
    difficulty: str,
    provider: str,
) -> List[Dict[str, Any]]:
    questions = parsed.get("questions") if isinstance(parsed, dict) else None
    if not isinstance(questions, list):
        return []

    normalized: List[Dict[str, Any]] = []
    diff_label = _difficulty_label(difficulty)
    for i, q in enumerate(questions, start=1):
        if not isinstance(q, dict):
            continue
        q_text = (q.get("question") or "").strip()
        if not q_text:
            continue
        q_type = (q.get("type") or ("coding" if difficulty == "coding" else "analytical")).strip().lower()
        item = {
            "id": q.get("id") or f"{provider}_{difficulty}_{i}",
            "question": q_text,
            "answer": (q.get("answer") or "").strip() or f"Provide a complete answer for {topic}.",
            "difficulty": q.get("difficulty") or diff_label,
            "topic": q.get("topic") or topic,
            "type": q_type,
            "language": (q.get("language") or "python") if q_type == "coding" else q.get("language"),
            "starter_code": q.get("starter_code") if q_type == "coding" else None,
            "test_cases": q.get("test_cases") if q_type == "coding" else None,
        }
        if q_type == "coding":
            q_lower = q_text.lower()
            practical_markers = ("implement", "write", "code", "function", "return")
            if not any(marker in q_lower for marker in practical_markers):
                continue
            if not item.get("starter_code"):
                item["starter_code"] = "def solve(input_data):\n    # Write your solution here\n    return \"\""
            tcs = item.get("test_cases") or []
            if not isinstance(tcs, list) or len(tcs) == 0:
                continue
            normalized_tcs = []
            for tc in tcs:
                if not isinstance(tc, dict):
                    continue
                normalized_tcs.append({
                    "input": str(tc.get("input", "")),
                    "expected_output": str(tc.get("expected_output", tc.get("expected", ""))),
                })
            if len(normalized_tcs) == 0:
                continue
            item["test_cases"] = normalized_tcs
        normalized.append(item)
    return normalized


def _generate_coding_fallback_questions(
    topic: Optional[str],
    count: int,
    existing_questions: set,
    session_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    base_topic = (topic or "General Coding").strip() or "General Coding"
    lower_topic = base_topic.lower()
    is_sql_topic = any(k in lower_topic for k in ["sql", "mysql", "postgres", "database", "sequel"])

    if is_sql_topic:
        sql_bank = [
            {
                "question": f"Write an SQL query for {base_topic}: Return each department name with the count of employees in it, ordered by count descending.",
                "starter_code": "-- Write SQL query here\nSELECT 1;",
                "test_cases": [
                    {
                        "setup_sql": "CREATE TABLE departments(id INTEGER PRIMARY KEY, name TEXT);"
                                     "CREATE TABLE employees(id INTEGER PRIMARY KEY, name TEXT, department_id INTEGER);"
                                     "INSERT INTO departments(id,name) VALUES (1,'Engineering'),(2,'HR');"
                                     "INSERT INTO employees(id,name,department_id) VALUES (1,'A',1),(2,'B',1),(3,'C',2);",
                        "expected_output": "Engineering|2\nHR|1",
                    }
                ],
            },
            {
                "question": f"Write an SQL query for {base_topic}: Find customers who placed more than 2 orders.",
                "starter_code": "-- Write SQL query here\nSELECT 1;",
                "test_cases": [
                    {
                        "setup_sql": "CREATE TABLE customers(id INTEGER PRIMARY KEY, name TEXT);"
                                     "CREATE TABLE orders(id INTEGER PRIMARY KEY, customer_id INTEGER);"
                                     "INSERT INTO customers VALUES (1,'A'),(2,'B'),(3,'C');"
                                     "INSERT INTO orders VALUES (1,1),(2,1),(3,1),(4,2);",
                        "expected_output": "A",
                    }
                ],
            },
            {
                "question": f"Write an SQL query for {base_topic}: Return the second highest salary from Employees table.",
                "starter_code": "-- Write SQL query here\nSELECT 1;",
                "test_cases": [
                    {
                        "setup_sql": "CREATE TABLE employees(id INTEGER PRIMARY KEY, salary INTEGER);"
                                     "INSERT INTO employees VALUES (1,100),(2,300),(3,200),(4,300);",
                        "expected_output": "200",
                    }
                ],
            },
        ]
        coding_bank = sql_bank
    else:
        coding_bank = [
        {
            "question": f"Write code for {base_topic}: Given integers N and K, print the sum of first N multiples of K.",
            "starter_code": "def solve(input_data):\n    n, k = map(int, input_data.strip().split())\n    # return result as string\n    return \"\"",
            "test_cases": [
                {"input": "5 3", "expected_output": "45"},
                {"input": "3 10", "expected_output": "60"},
                {"input": "1 7", "expected_output": "7"},
            ],
        },
        {
            "question": f"Write code for {base_topic}: Given a string, return the frequency of each character sorted by character.",
            "starter_code": "def solve(input_data):\n    s = input_data.strip()\n    # output format: a:2 b:1 ...\n    return \"\"",
            "test_cases": [
                {"input": "aab", "expected_output": "a:2 b:1"},
                {"input": "zzz", "expected_output": "z:3"},
                {"input": "abca", "expected_output": "a:2 b:1 c:1"},
            ],
        },
        {
            "question": f"Write code for {base_topic}: Given an array of integers, output the maximum subarray sum.",
            "starter_code": "def solve(input_data):\n    arr = list(map(int, input_data.strip().split()))\n    # return max subarray sum as string\n    return \"\"",
            "test_cases": [
                {"input": "1 -2 3 4 -1", "expected_output": "7"},
                {"input": "-5 -2 -1", "expected_output": "-1"},
                {"input": "2 3 -2 5", "expected_output": "8"},
            ],
        },
        {
            "question": f"Write code for {base_topic}: Given N, print all prime numbers <= N separated by spaces.",
            "starter_code": "def solve(input_data):\n    n = int(input_data.strip())\n    # return primes as space-separated string\n    return \"\"",
            "test_cases": [
                {"input": "10", "expected_output": "2 3 5 7"},
                {"input": "2", "expected_output": "2"},
                {"input": "1", "expected_output": ""},
            ],
        },
        {
            "question": f"Write code for {base_topic}: Given two sorted arrays, merge them into one sorted array.",
            "starter_code": "def solve(input_data):\n    lines = [ln.strip() for ln in input_data.strip().splitlines() if ln.strip()]\n    a = list(map(int, lines[0].split())) if lines else []\n    b = list(map(int, lines[1].split())) if len(lines) > 1 else []\n    # return merged array as space-separated string\n    return \"\"",
            "test_cases": [
                {"input": "1 3 5\n2 4 6", "expected_output": "1 2 3 4 5 6"},
                {"input": "1 2 3\n", "expected_output": "1 2 3"},
                {"input": "\n4 5", "expected_output": "4 5"},
            ],
        },
        ]

    results: List[Dict[str, Any]] = []
    idx = 1
    attempts = 0
    max_attempts = max(count * 4, 20)
    while len(results) < count and attempts < max_attempts:
        sample = coding_bank[attempts % len(coding_bank)]
        q = sample["question"]
        q_key = q.strip().lower()
        if q_key not in existing_questions:
            existing_questions.add(q_key)
            results.append({
                "id": f"{session_id or 'generated'}_coding_{idx}",
                "question": q,
                "answer": f"Provide a correct and efficient implementation for {base_topic}.",
                "difficulty": "Medium",
                "topic": base_topic,
                "type": "coding",
                "language": "sql" if is_sql_topic else "python",
                "starter_code": sample["starter_code"],
                "test_cases": sample["test_cases"],
            })
            idx += 1
        attempts += 1
    return results


async def _generate_questions_parallel_with_backfill(
    topic: Optional[str],
    difficulty: Optional[str],
    needed_count: int,
    existing_questions: set,
    session_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    if needed_count <= 0:
        return []

    base_topic = (topic or "General").strip() or "General"
    diff_key = (difficulty or "medium").strip().lower()
    desired_type = "coding" if diff_key == "coding" else "analytical"
    per_provider_count = max(needed_count, 5)

    prompt = f"""Generate {per_provider_count} unique {diff_key} interview questions for topic: {base_topic}.
Return ONLY JSON with this schema:
{{
  "questions": [
    {{
      "question": "text",
      "answer": "ideal answer",
      "difficulty": "{_difficulty_label(diff_key)}",
      "topic": "{base_topic}",
      "type": "{desired_type}",
      "language": "python",
      "starter_code": "",
      "test_cases": [{{"input": "", "expected_output": ""}}]
    }}
  ]
}}
Rules:
- No markdown.
- Ensure questions are interview-ready and non-duplicate.
- If type is analytical, omit coding-only fields.
- If type is coding, generate ONLY practical implementation problems (no theory/explain-only).
- For coding questions, include at least 3 valid test_cases with input and expected_output.
"""

    parallel = await call_ai_parallel(
        messages=[
            {"role": "system", "content": "Return strict JSON only."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.7,
        max_tokens=2500,
        providers=["gemini", "claude", "openai", "deepseek"],
    )

    pooled: List[Dict[str, Any]] = []
    for success in parallel["successes"]:
        provider = success["provider"]
        parsed = parse_json_response(success["raw_text"])
        if not parsed:
            continue
        pooled.extend(_extract_questions_from_ai_payload(parsed, base_topic, diff_key, provider))

    merged: List[Dict[str, Any]] = []
    for q in pooled:
        q_key = (q.get("question") or "").strip().lower()
        if not q_key or q_key in existing_questions:
            continue
        if diff_key == "coding" and (q.get("type") or "").lower() != "coding":
            continue
        existing_questions.add(q_key)
        merged.append(q)
        if len(merged) >= needed_count:
            break

    remaining = needed_count - len(merged)
    if remaining > 0:
        if diff_key == "coding":
            merged.extend(_generate_coding_fallback_questions(base_topic, remaining, existing_questions, session_id=session_id))
        else:
            merged.extend(
                _generate_topic_questions(
                    base_topic,
                    diff_key,
                    remaining,
                    existing_questions,
                    session_id=session_id,
                )
            )
    return merged


def _normalize_skill(skill: str) -> str:
    """Normalize skill names for deduplication (handles variants)."""
    if not skill:
        return ""
    normalized = skill.lower().strip()
    # Map common variations
    variations = {
        "js": "javascript",
        "typescript": "typescript",
        "ts": "typescript",
        "py": "python",
        "cpp": "c++",
        "c plus plus": "c++",
        "c#": "csharp",
        "dotnet": ".net",
        "node": "nodejs",
        "node.js": "nodejs",
        "mongo": "mongodb",
        "sql server": "mssql",
        "postgres": "postgresql",
        "react.js": "react",
        "vue.js": "vue",
        "angular.js": "angular",
        "fastapi": "fastapi (python)",
        "express": "express (nodejs)",
        "spring": "spring (java)",
        "django": "django (python)",
        "rest api": "rest api",
        "restful": "rest api",
        "graphql api": "graphql",
        "ml": "machine learning",
        "ai": "artificial intelligence",
        "llm": "large language model",
        "nlp": "natural language processing",
    }
    return variations.get(normalized, normalized)

def _get_skill_category(skill: str) -> str:
    """Categorize a skill into domain area (for better grouping)."""
    skill_lower = skill.lower()
    categories = {
        "frontend": ["react", "vue", "angular", "html", "css", "sass", "webpack", "nextjs", "svelte"],
        "backend": ["nodejs", "python", "java", "golang", "rust", "csharp", "php", "ruby", "django", "fastapi", "spring", "express"],
        "database": ["mongodb", "postgresql", "mysql", "redis", "elasticsearch", "dynamodb", "oracle", "cassandra", "firestore"],
        "devops": ["docker", "kubernetes", "jenkins", "gitlab", "github actions", "terraform", "aws", "gcp", "azure", "ci/cd"],
        "mobile": ["react native", "flutter", "swift", "kotlin", "ios", "android"],
        "machine learning": ["tensorflow", "pytorch", "scikit-learn", "machine learning", "deep learning", "nlp", "ai", "llm"],
        "data": ["data science", "analytics", "pandas", "numpy", "spark", "hadoop"],
    }
    for category, keywords in categories.items():
        for keyword in keywords:
            if keyword in skill_lower:
                return category
    return "other"

def _get_top_topics(questions: List[Dict[str, Any]], fallback: List[str], limit: int = 5) -> List[str]:
    """
    Advanced topic extraction with skill normalization, deduplication, and relevance scoring.
    Strategy: Frequency in questions + Skill relevance + Categorization + Normalized duplicates
    """
    # 1. Collect and score topics from questions
    topic_scores: Dict[str, float] = {}
    topic_frequencies: Dict[str, int] = {}
    
    for q in questions:
        topic = (q.get("topic") or "").strip()
        if not topic:
            continue
        
        # Normalize topic
        norm_topic = _normalize_skill(topic)
        if not norm_topic:
            continue
        
        # Track frequency
        topic_frequencies[norm_topic] = topic_frequencies.get(norm_topic, 0) + 1
        
        # Score based on difficulty (harder questions weighted higher)
        difficulty = (q.get("difficulty") or "medium").lower()
        difficulty_weight = {"easy": 1.0, "medium": 1.5, "hard": 2.0}.get(difficulty, 1.0)
        
        topic_scores[norm_topic] = topic_scores.get(norm_topic, 0) + difficulty_weight
    
    # 2. Rank topics by combined score (frequency + difficulty weight)
    sorted_topics = [
        t[0] for t in sorted(
            topic_scores.items(),
            key=lambda x: (topic_frequencies.get(x[0], 1), x[1]),
            reverse=True
        )
    ]
    
    # 3. Deduplicate and enrich with skills
    existing_topics = set(t.lower() for t in sorted_topics)
    final_topics: List[str] = list(sorted_topics[:limit]) if sorted_topics else []
    
    # 4. Add fallback skills (deduplicated, normalized)
    if fallback and len(final_topics) < limit:
        normalized_skills = []
        skill_set = set()
        
        for skill in fallback:
            normalized = _normalize_skill(skill)
            skill_lower = normalized.lower()
            
            # Skip if already exists
            if skill_lower in existing_topics or skill_lower in skill_set:
                continue
            
            normalized_skills.append((normalized, _get_skill_category(normalized)))
            skill_set.add(skill_lower)
            existing_topics.add(skill_lower)
        
        # Sort by category importance (backend/frontend first, then others)
        category_priority = {
            "frontend": 0, "backend": 1, "database": 2, "devops": 3,
            "mobile": 4, "machine learning": 5, "data": 6, "other": 7
        }
        
        normalized_skills.sort(key=lambda x: category_priority.get(x[1], 999))
        
        for skill, _ in normalized_skills:
            if len(final_topics) >= limit:
                break
            final_topics.append(skill)
    
    # 5. Return final list or fallback
    return final_topics if final_topics else (fallback or [])[:limit]

def _difficulty_label(value: Optional[str]) -> str:
    if not value:
        return "Medium"
    v = value.strip().lower()
    if v == "easy":
        return "Easy"
    if v == "hard":
        return "Hard"
    return "Medium"


def _canonical_question_text(text: str) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", text).strip().lower()


def _collect_user_seen_questions(db, user_id: str, max_sessions: int = 30) -> set:
    """
    Collect normalized question text seen by this user in prior sessions.
    Used to avoid re-serving the same questions across uploads.
    """
    seen: set = set()
    try:
        cursor = db.user_sessions.find(
            {"user_id": user_id},
            {"questions": 1, "all_questions": 1},
            sort=[("created_at", -1)],
            limit=max_sessions,
        )
        for session in cursor:
            q_list = session.get("questions") or session.get("all_questions") or []
            for q in q_list:
                q_text = _canonical_question_text((q or {}).get("question") or "")
                if q_text:
                    seen.add(q_text)
    except Exception as e:
        logger.warning(f"Failed to collect user seen questions: {e}")
    return seen


async def _freshen_questions_for_user(
    db,
    user_id: str,
    questions: List[Dict[str, Any]],
    session_id: Optional[str] = None,
    max_replacements: int = 40,
) -> List[Dict[str, Any]]:
    """
    Replace questions previously seen by the same user with newly generated ones.
    Keeps cache speed by reusing existing pools first, then backfilling only deltas.
    """
    if not questions:
        return []

    seen_history = _collect_user_seen_questions(db, user_id=user_id)
    if not seen_history:
        # No prior history for this user; preserve original ordering.
        return questions

    fresh: List[Dict[str, Any]] = []
    current_seen: set = set()
    replacement_plan: Dict[tuple, int] = defaultdict(int)

    for q in questions:
        q_text = _canonical_question_text((q or {}).get("question") or "")
        if not q_text:
            continue
        if q_text in current_seen:
            continue
        if q_text in seen_history:
            topic = ((q or {}).get("topic") or "General").strip() or "General"
            q_type = (((q or {}).get("type") or "").strip().lower())
            raw_diff = (((q or {}).get("difficulty") or "medium").strip().lower())
            diff_key = "coding" if q_type == "coding" else (raw_diff if raw_diff in {"easy", "medium", "hard"} else "medium")
            replacement_plan[(topic, diff_key)] += 1
            continue

        current_seen.add(q_text)
        fresh.append(q)

    if not replacement_plan:
        random.shuffle(fresh)
        return fresh

    blocked = set(seen_history) | set(current_seen)
    replacements_done = 0

    for (topic, diff_key), needed in replacement_plan.items():
        if replacements_done >= max_replacements:
            break
        remaining_budget = max_replacements - replacements_done
        ask = min(needed, remaining_budget)
        if ask <= 0:
            continue
        generated = await _generate_questions_parallel_with_backfill(
            topic=topic,
            difficulty=diff_key,
            needed_count=ask,
            existing_questions=blocked,
            session_id=session_id,
        )
        for g in generated:
            q_key = _canonical_question_text(g.get("question") or "")
            if not q_key or q_key in blocked:
                continue
            blocked.add(q_key)
            fresh.append(g)
            replacements_done += 1
            if replacements_done >= max_replacements:
                break

    # Keep size stable if backfill cannot fully satisfy due to provider/fallback limits.
    if len(fresh) < len(questions):
        for q in questions:
            q_key = _canonical_question_text((q or {}).get("question") or "")
            if not q_key or q_key in blocked:
                continue
            blocked.add(q_key)
            fresh.append(q)
            if len(fresh) >= len(questions):
                break

    random.shuffle(fresh)
    return fresh[: len(questions)]

def _detect_programming_languages(questions: List[Dict[str, Any]], skills: List[str]) -> List[str]:
    """
    Advanced programming language detection with framework/library/tool inference.
    Strategies: Direct detection + Framework detection + Ecosystem detection + DSA inference
    """
    # Framework/library to language mapping (comprehensive)
    framework_to_lang = {
        # JavaScript/TypeScript
        "react": "javascript",
        "vue": "javascript",
        "angular": "javascript",
        "nextjs": "javascript",
        "nuxt": "javascript",
        "gatsby": "javascript",
        "svelte": "javascript",
        "webpack": "javascript",
        "babel": "javascript",
        "express": "javascript",
        "nest": "javascript",
        "apollo": "javascript",
        "graphql": "javascript",
        "node": "javascript",
        "npm": "javascript",
        "yarn": "javascript",
        "electron": "javascript",
        # Python
        "django": "python",
        "flask": "python",
        "fastapi": "python",
        "pytorch": "python",
        "tensorflow": "python",
        "scikit": "python",
        "pandas": "python",
        "numpy": "python",
        "requests": "python",
        "pip": "python",
        "conda": "python",
        "jupyter": "python",
        "celery": "python",
        # Java
        "spring": "java",
        "maven": "java",
        "gradle": "java",
        "hibernate": "java",
        "junit": "java",
        # Go
        "gin": "golang",
        "iris": "golang",
        # Rust
        "cargo": "rust",
        "tokio": "rust",
        # Ruby
        "rails": "ruby",
        "gem": "ruby",
        # C#/.NET
        "dotnet": "c#",
        "asp.net": "c#",
        "entity framework": "c#",
        # PHP
        "laravel": "php",
        "symfony": "php",
        "composer": "php",
        # Swift/iOS
        "cocoapods": "swift",
        "xcode": "swift",
        # Kotlin/Android
        "gradle": "kotlin",
        "android": "kotlin",
        # Other ecosystems
        "docker": "*",  # Multi-language
        "kubernetes": "*",
    }
    
    dsa_keywords = [
        "data structure", "algorithm", "coding", "leetcode", "hackerrank",
        "array", "linked list", "tree", "graph", "sort", "search",
        "dynamic programming", "recursion", "backtracking", "greedy"
    ]
    
    detected_langs = set()
    has_dsa = False
    
    # Strategy 1: Direct language detection from explicit language field or text
    common_langs = {
        "python": ["python", "py"],
        "javascript": ["javascript", "js", "nodejs", "node"],
        "typescript": ["typescript", "ts"],
        "java": ["java"],
        "c++": ["c++", "cpp", "c plus plus"],
        "c": [" c ", " c,"],  # word-boundary approximation
        "kotlin": ["kotlin"],
        "swift": ["swift"],
        "csharp": ["c#", "csharp", "c-sharp"],
        "ruby": ["ruby"],
        "php": ["php"],
        "golang": ["golang", "go ", " go"],
        "rust": ["rust"],
        "scala": ["scala"],
        "r": [" r ", " r,"],  # word-boundary approximation
    }
    
    # Check questions for language mentions
    for q in questions:
        question_text = (q.get("question") or "").lower()
        language_field = (q.get("language") or "").lower()
        
        # Explicit language field
        if language_field:
            for lang, patterns in common_langs.items():
                if any(p in language_field for p in patterns):
                    detected_langs.add(lang)
        
        # Search question text
        for lang, patterns in common_langs.items():
            for pattern in patterns:
                if pattern in question_text:
                    detected_langs.add(lang)
        
        # Check for frameworks/libraries in question
        for framework, lang in framework_to_lang.items():
            if framework in question_text and lang != "*":
                detected_langs.add(lang)
    
    # Strategy 2: Framework/Library detection from skills
    for skill in skills:
        skill_lower = skill.lower()
        
        # Direct language match
        for lang, patterns in common_langs.items():
            for pattern in patterns:
                if pattern in skill_lower:
                    detected_langs.add(lang)
        
        # Framework detection
        for framework, lang in framework_to_lang.items():
            if framework in skill_lower and lang != "*":
                detected_langs.add(lang)
    
    # Strategy 3: Check for DSA/Coding topics
    for q in questions:
        topic = (q.get("topic") or "").lower()
        for keyword in dsa_keywords:
            if keyword in topic:
                has_dsa = True
                break
    
    for skill in skills:
        skill_lower = skill.lower()
        for keyword in dsa_keywords:
            if keyword in skill_lower:
                has_dsa = True
                break
    
    # Deduplicate and normalize
    result = list(detected_langs)
    
    # Remove internal duplicates (e.g., both "python" and "py" detected)
    lang_groups = {
        "javascript": ["javascript"],
        "typescript": ["typescript"],  # Keep separate from JS
        "python": ["python"],
        "java": ["java"],
        "c++": ["c++"],
        "c": ["c"],
        "csharp": ["csharp"],
        "ruby": ["ruby"],
        "php": ["php"],
        "golang": ["golang"],
        "rust": ["rust"],
        "kotlin": ["kotlin"],
        "swift": ["swift"],
        "scala": ["scala"],
        "r": ["r"],
    }
    
    # If DSA/coding detected but no explicit language, infer from skills
    if has_dsa and not result:
        # Check if any backend languages mentioned (prefer for DSA)
        backend_langs = {"python", "java", "c++", "javascript"}
        for skill in skills:
            skill_lower = skill.lower()
            for lang in backend_langs:
                if lang in skill_lower:
                    result.append(lang)
                    break
        
        # Default to Python + Java if still empty
        if not result:
            result = ["python", "java"]
    
    return sorted(list(set(result)))  # Unique and sorted

def _semantic_similarity(text1: str, text2: str) -> float:
    """Semantic similarity using TF-IDF cosine (Approach 2D: Duplicate Detection)"""
    tokens1 = _tokenize(text1)
    tokens2 = _tokenize(text2)
    if not tokens1 or not tokens2:
        return 0.0
    return _tf_idf_cosine(tokens1, tokens2)

def _generate_topic_questions(
    topic: Optional[str],
    difficulty: Optional[str],
    count: int,
    existing_questions: set,
    session_id: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Generate interview questions using templates with semantic duplicate detection (Approach 2D)
    Uses simpler template-based approach (not async), suitable for quick generation
    """
    base_topic = (topic or "General").strip() or "General"
    diff_key = (difficulty or "medium").strip().lower()
    diff_label = _difficulty_label(difficulty)

    templates = {
        "easy": [
            "Explain the fundamentals of {topic} with an example from your resume.",
            "What is {topic}, and where did you apply it in your projects?",
            "Describe a basic workflow or process in {topic}.",
            "List key concepts in {topic} and how you used them.",
            "Walk through a simple {topic} task you completed.",
        ],
        "medium": [
            "Compare two approaches in {topic} and explain why you chose one.",
            "Describe a challenge you faced in {topic} and how you solved it.",
            "Explain the trade-offs you considered when working on {topic}.",
            "How would you debug a common issue in {topic}?",
            "What design patterns do you follow in {topic}?",
        ],
        "hard": [
            "Design an end-to-end solution for a complex {topic} problem.",
            "How would you scale or optimize a {topic} system?",
            "Describe a security vulnerability in {topic} and mitigation strategy.",
            "How would you architect {topic} for multi-region deployment?",
            "Propose a disaster recovery strategy for a mission-critical {topic} service.",
        ],
    }

    if diff_key not in templates:
        diff_key = "medium"

    results: List[Dict[str, Any]] = []
    pool = templates[diff_key]
    attempts = 0
    index = 1
    max_attempts = max(len(pool) * 3, count + 10)  # allow multiple cycles through pool
    
    # Generate questions using templates with semantic duplicate detection
    while len(results) < count and attempts < max_attempts:
        template = pool[attempts % len(pool)]
        question = template.format(topic=base_topic)
        
        # Semantic duplicate detection (Approach 2D)
        is_duplicate = any(
            _semantic_similarity(question.lower(), existing_q.lower()) > 0.7
            for existing_q in existing_questions
        )
        
        if not is_duplicate:
            q_key = question.strip().lower()
            if q_key not in existing_questions:
                existing_questions.add(q_key)
                results.append({
                    "id": f"{session_id or 'generated'}_{diff_key}_{index}",
                    "question": question,
                    "answer": f"Provide a comprehensive explanation relating to {base_topic}.",
                    "difficulty": diff_label,
                    "topic": base_topic,
                })
                index += 1
        
        attempts += 1

    return results



def _semantic_resume_hash(skills: List[str], experience: str) -> str:
    """
    Create semantic content hash based on extracted resume content
    (Approach 3A: Semantic caching instead of byte-for-byte matching)
    """
    content = f"{' '.join(sorted(skills)).lower()}|{experience.lower()[:500]}"
    return hashlib.sha256(content.encode()).hexdigest()

def _has_expired_cache(cache_entry: Dict[str, Any], ttl_days: int = 90) -> bool:
    """
    Check if cache entry has expired (Approach 3C: TTL for freshness)
    """
    created_at = cache_entry.get("created_at")
    if not created_at:
        return True
    age = (datetime.now() - created_at).days
    return age > ttl_days

def _find_similar_resume_cache(
    skills: List[str],
    experience: str,
    db_collection,
    similarity_threshold: float = 0.75
) -> Optional[Dict[str, Any]]:
    """
    Find similar resume in cache using semantic matching (Approach 3A)
    Returns recent non-expired cache with similar skills
    """
    # First try exact semantic hash match
    content_hash = _semantic_resume_hash(skills, experience)
    exact_match = db_collection.find_one({
        "semantic_hash": content_hash,
    })
    if exact_match and not _has_expired_cache(exact_match):
        return exact_match
    
    # Then search for semantically similar resumes
    all_caches = list(db_collection.find({}).sort("times_served", -1).limit(100))
    for cache in all_caches:
        if _has_expired_cache(cache):
            continue
        cache_skills = cache.get("all_skills", [])
        # Calculate skill overlap
        cache_skills_set = set(s.lower() for s in cache_skills)
        input_skills_set = set(s.lower() for s in skills)
        if not cache_skills_set or not input_skills_set:
            continue
        overlap = len(cache_skills_set & input_skills_set)
        union = len(cache_skills_set | input_skills_set)
        similarity = overlap / union if union > 0 else 0
        if similarity >= similarity_threshold:
            return cache
    
    return None

app = FastAPI(title="Endeavor RAG API")

# CORS middleware
cors_origins = os.getenv("CORS_ORIGINS", "*").split(",")
# Always allow known frontend deployments
_known_frontends = [
    "https://my-mockmate.vercel.app",
    "https://mockmate.onrender.com",
]
for origin in _known_frontends:
    if origin not in cors_origins:
        cors_origins.append(origin)
# Also allow any Vercel preview deployments for this project
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=r"https://frontend-.*-addagada123s-projects\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure uploads dir exists
os.makedirs("uploads", exist_ok=True)

# Include auth router
app.include_router(auth_router, prefix="/auth", tags=["authentication"])

# Pydantic models
class QuestionAnswer(BaseModel):
    question: str
    user_answer: str
    correct_answer: Optional[str] = None

class TestSubmission(BaseModel):
    session_id: str
    answers: List[QuestionAnswer]
    topic: Optional[str] = None
    difficulty: Optional[str] = None
    time_spent: Optional[int] = None
    tab_switches: Optional[int] = None
    mode: Optional[str] = None

class GenerateTestQuestionsRequest(BaseModel):
    session_id: Optional[str] = None
    topic: Optional[str] = None
    difficulty: Optional[str] = None
    num_questions: Optional[int] = 10

class JobRecommendation(BaseModel):
    title: str
    description: str
    match_score: float
    required_skills: List[str]
    missing_skills: List[str]

class CommTestRequest(BaseModel):
    section: Optional[str] = None  # reading, email, grammar, situational, spoken
    difficulty: Optional[str] = "medium"

class CommTestSubmission(BaseModel):
    answers: List[Dict[str, Any]]  # [{question_id, question, user_answer, correct_answer, section}]
    time_spent: Optional[int] = None

class RunCodeRequest(BaseModel):
    language: str  # "python", "java", "cpp", "javascript", "c"
    code: str
    test_cases: Optional[List[Dict[str, str]]] = None  # [{input, expected_output}]
    compile_only: Optional[bool] = False


class VRStartRequest(BaseModel):
    session_id: str
    topic: Optional[str] = None
    difficulty: Optional[str] = None
    questions: Optional[List[Dict[str, Any]]] = None


class VRAnswerRequest(BaseModel):
    question_index: int
    user_answer: str


class VRCompleteRequest(BaseModel):
    session_id: str
    time_spent: Optional[int] = None


class VRBridgeAnswerRequest(BaseModel):
    question_index: int
    user_answer: str


class VRBridgeCompleteRequest(BaseModel):
    time_spent: Optional[int] = None

# Upload directory
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

_STOP_WORDS = frozenset({
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "shall",
    "should", "may", "might", "can", "could", "must", "and", "but", "or",
    "nor", "not", "if", "then", "else", "when", "up", "out", "on", "off",
    "over", "under", "again", "further", "once", "here", "there", "all",
    "each", "every", "both", "few", "more", "most", "other", "some", "such",
    "no", "only", "same", "so", "than", "too", "very", "just", "because",
    "as", "until", "while", "of", "at", "by", "for", "with", "about",
    "between", "through", "during", "before", "after", "above", "below",
    "to", "from", "in", "into", "what", "which", "who", "whom", "this",
    "that", "these", "those", "am", "it", "its", "how", "why", "where",
    "your", "you", "explain", "describe", "discuss", "compare", "list",
})


def _tokenize(text: str) -> List[str]:
    """Tokenize and lowercase, removing stop-words and short tokens."""
    return [
        w for w in re.findall(r"[a-z0-9#+.\-]+", text.lower())
        if w not in _STOP_WORDS and len(w) > 1
    ]


def _tf_idf_cosine(tokens_a: List[str], tokens_b: List[str]) -> float:
    """
    Compute cosine similarity between two token lists using TF-IDF weighting.
    IDF is approximated from the two documents as the corpus.
    """
    if not tokens_a or not tokens_b:
        return 0.0

    doc_freq: Counter = Counter()
    tf_a = Counter(tokens_a)
    tf_b = Counter(tokens_b)
    all_terms = set(tf_a) | set(tf_b)

    for term in all_terms:
        doc_freq[term] = (1 if term in tf_a else 0) + (1 if term in tf_b else 0)

    def weighted(tf_map: Counter) -> Dict[str, float]:
        vec: Dict[str, float] = {}
        for term, freq in tf_map.items():
            idf = math.log(2 / doc_freq[term]) + 1  # smoothed IDF
            vec[term] = freq * idf
        return vec

    va, vb = weighted(tf_a), weighted(tf_b)
    dot = sum(va.get(t, 0) * vb.get(t, 0) for t in all_terms)
    mag_a = math.sqrt(sum(v ** 2 for v in va.values())) or 1
    mag_b = math.sqrt(sum(v ** 2 for v in vb.values())) or 1
    return dot / (mag_a * mag_b)


# Technical keyword groups for bonus scoring
_TECHNICAL_MARKERS = {
    "concepts": [
        "algorithm", "complexity", "o(n)", "o(1)", "o(log", "big-o",
        "architecture", "design pattern", "solid", "dry", "kiss",
        "scalability", "latency", "throughput", "caching", "indexing",
        "normalization", "denormalization", "sharding", "replication",
        "microservice", "monolith", "api", "rest", "graphql", "grpc",
        "concurrency", "parallelism", "thread", "async", "await",
        "encryption", "authentication", "authorization", "jwt", "oauth",
    ],
    "structure": [
        "first", "second", "third", "step", "because", "therefore",
        "however", "for example", "in addition", "furthermore",
        "in conclusion", "trade-off", "pros and cons", "advantage",
        "disadvantage", "compared to", "alternatively",
    ],
}


def simple_evaluate_answer(question: str, user_answer: str, correct_answer: str = "") -> Dict:
    """
    Advanced multi-signal answer evaluation algorithm:
      1. TF-IDF cosine similarity between answer â†” correct_answer (40% weight)
      2. Question-relevance score via keyword coverage (20% weight)
      3. Answer depth â€” word count, sentence count, technical markers (20% weight)
      4. Structural quality â€” transitions, examples, coherence signals (10% weight)
      5. Correct-answer n-gram overlap for factual recall (10% weight)
    Falls back gracefully when correct_answer is empty.
    """
    if not user_answer or not user_answer.strip():
        return {"score": 0, "feedback": "No answer provided.", "is_correct": False}

    ans_tokens = _tokenize(user_answer)
    q_tokens = _tokenize(question)
    ref_tokens = _tokenize(correct_answer) if correct_answer else []
    ans_lower = user_answer.lower()
    word_count = len(user_answer.split())
    sentence_count = max(1, len(re.split(r"[.!?]+", user_answer.strip())))

    # --- Signal 1: TF-IDF cosine similarity with correct answer (0-40) ---
    if ref_tokens:
        cosine_sim = _tf_idf_cosine(ans_tokens, ref_tokens)
        signal_similarity = cosine_sim * 40
    else:
        # If no reference, use question-answer relevance as proxy (capped at 25)
        cosine_sim = _tf_idf_cosine(ans_tokens, q_tokens)
        signal_similarity = min(cosine_sim * 40, 25)

    # --- Signal 2: Question keyword coverage (0-20) ---
    if q_tokens:
        q_set = set(q_tokens)
        covered = sum(1 for t in q_set if t in set(ans_tokens))
        coverage_ratio = covered / len(q_set)
    else:
        coverage_ratio = 0.5  # neutral
    signal_relevance = coverage_ratio * 20

    # --- Signal 3: Answer depth â€” length + technical richness (0-20) ---
    # Length component (0-10): reward detailed answers, diminishing returns after ~120 words
    length_score = min(10, (word_count / 120) * 10) if word_count > 0 else 0

    # Technical marker bonus (0-10)
    tech_hits = 0
    for markers in _TECHNICAL_MARKERS["concepts"]:
        if markers in ans_lower:
            tech_hits += 1
    tech_score = min(10, tech_hits * 2.5)

    signal_depth = length_score + tech_score

    # --- Signal 4: Structural quality â€” coherence markers (0-10) ---
    structure_hits = sum(1 for m in _TECHNICAL_MARKERS["structure"] if m in ans_lower)
    signal_structure = min(10, structure_hits * 2)

    # --- Signal 5: N-gram factual recall against correct answer (0-10) ---
    signal_ngram = 0.0
    if ref_tokens and len(ref_tokens) >= 2:
        ref_bigrams = set(zip(ref_tokens, ref_tokens[1:]))
        ans_bigrams = set(zip(ans_tokens, ans_tokens[1:])) if len(ans_tokens) >= 2 else set()
        if ref_bigrams:
            overlap = len(ref_bigrams & ans_bigrams)
            signal_ngram = min(10, (overlap / len(ref_bigrams)) * 10)

    # --- Combine ---
    raw_score = (
        signal_similarity
        + signal_relevance
        + signal_depth
        + signal_structure
        + signal_ngram
    )

    # Penalties
    if word_count < 5:
        raw_score *= 0.3  # very short answer penalty
    elif word_count < 15:
        raw_score *= 0.6  # short answer penalty

    # Bonus for multi-sentence well-structured answers
    if sentence_count >= 3 and word_count >= 40:
        raw_score = min(100, raw_score + 5)

    score = max(0, min(100, int(round(raw_score))))
    is_correct = score >= 55

    # --- Generate detailed feedback ---
    feedback_parts: List[str] = []
    if score >= 85:
        feedback_parts.append("Excellent answer with strong coverage and depth.")
    elif score >= 70:
        feedback_parts.append("Good answer that covers the key points.")
    elif score >= 55:
        feedback_parts.append("Acceptable answer, but could use more depth.")
    else:
        feedback_parts.append("Needs improvement â€” try to address the core concepts.")

    if word_count < 20:
        feedback_parts.append("Consider providing a more detailed response.")
    if coverage_ratio < 0.3 and q_tokens:
        feedback_parts.append("Try to address the specific terms mentioned in the question.")
    if tech_hits == 0 and word_count > 20:
        feedback_parts.append("Including technical terminology and concepts would strengthen your answer.")
    if structure_hits < 2 and word_count > 30:
        feedback_parts.append("Use transition words (e.g., 'because', 'for example') to improve clarity.")
    if ref_tokens and cosine_sim < 0.2:
        feedback_parts.append("Review the expected answer â€” your response diverges from the key points.")

    return {
        "score": score,
        "feedback": " ".join(feedback_parts),
        "is_correct": is_correct,
        "breakdown": {
            "similarity": round(signal_similarity, 1),
            "relevance": round(signal_relevance, 1),
            "depth": round(signal_depth, 1),
            "structure": round(signal_structure, 1),
            "factual_recall": round(signal_ngram, 1),
        },
    }

@app.get("/")
async def root():
    """Root endpoint"""
    return {"message": "Endeavor RAG API - Interview Question Generator"}

@app.get("/favicon.ico")
async def favicon():
    """Empty favicon to avoid 404s"""
    return Response(status_code=204)

@app.get("/health")
async def health():
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


# --- Keep-Alive Self-Ping (prevents Render free tier cold starts) ---
_keep_alive_task = None

async def _keep_alive_loop():
    """Ping own /health endpoint every 13 minutes to prevent Render sleep (15min idle timeout)"""
    import httpx
    # Determine our public URL
    render_url = os.getenv("RENDER_EXTERNAL_URL")  # Render sets this automatically
    base_url = render_url or os.getenv("PUBLIC_URL", "")
    if not base_url:
        logger.info("Keep-alive: No RENDER_EXTERNAL_URL set, skipping (local dev)")
        return
    health_url = f"{base_url}/health"
    logger.info(f"Keep-alive started: pinging {health_url} every 13 min")
    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            await asyncio.sleep(780)  # 13 minutes
            try:
                resp = await client.get(health_url)
                logger.debug(f"Keep-alive ping: {resp.status_code}")
            except Exception as e:
                logger.warning(f"Keep-alive ping failed: {e}")

@app.on_event("startup")
async def startup_event():
    global _keep_alive_task
    _keep_alive_task = asyncio.create_task(_keep_alive_loop())

@app.get("/user-session")
async def get_latest_user_session(
    current_user: Dict = Depends(get_current_user)
):
    """
    Get latest user session summary
    """
    try:
        db = get_db()

        session = db.user_sessions.find_one(
            {"user_id": current_user["id"]},
            sort=[("created_at", -1)]
        )

        if not session:
            return {
                "success": False,
                "message": "No session found"
            }

        return {
            "success": True,
            "session_id": str(session.get("_id")),
            "questions": session.get("questions", []),
            "topicsDetected": session.get("skills", []),
            "experience": session.get("experience", ""),
            "status": session.get("status", "in_progress")
        }

    except Exception as e:
        logger.error(f"Error fetching latest session: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch latest session: {str(e)}"
        )

@app.post("/upload-resume")
async def upload_resume(
    file: UploadFile = File(...),
    force_regenerate: bool = False,
    current_user: Dict = Depends(get_current_user)
):
    """
    Upload resume and generate interview questions
    Uses semantic caching (Approach 3A), TTL expiration (Approach 3C), and similarity matching (Approach 3B)
    """
    try:
        # Validate file type
        if not file.filename or not file.filename.endswith('.pdf'):
            raise HTTPException(
                status_code=400,
                detail="Only PDF files are supported"
            )
        
        # Save file
        file_path = os.path.join(UPLOAD_DIR, f"{current_user['id']}_{file.filename}")
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        logger.info(f"Resume uploaded: {file_path}")

        # Compute byte-based hash for exact match
        with open(file_path, "rb") as f:
            resume_hash = hashlib.sha256(f.read()).hexdigest()

        db = get_db()

        # Stage 1: Check byte-exact match for THIS USER only (no cross-user reuse)
        cached_resume = db.resume_question_cache.find_one({
            "resume_hash": resume_hash,
            "user_id": current_user["id"],
        })
        
        # Stage 2: Check TTL - if expired, treat as cache miss (Approach 3C)
        if cached_resume and _has_expired_cache(cached_resume, ttl_days=90):
            logger.info(f"Cache EXPIRED for hash={resume_hash[:12]}... (90day TTL)")
            db.resume_question_cache.delete_one({"_id": cached_resume["_id"]})
            cached_resume = None

        # If force_regenerate, delete cache entry
        if cached_resume and force_regenerate:
            db.resume_question_cache.delete_one({"_id": cached_resume["_id"]})
            logger.info(f"Cache BUSTED (force_regenerate) for hash={resume_hash[:12]}...")
            cached_resume = None

        if not cached_resume:
            # Try to find similar resume in cache (Approach 3B: semantic matching)
            # This will be populated after first generation
            pass

        if cached_resume:
            logger.info(f"Resume cache HIT (exact) for user={current_user['id']}")
            limited_topics = cached_resume.get("skills", [])
            all_skills = cached_resume.get("all_skills", [])
            experience = cached_resume.get("experience", "")
            detected_languages = cached_resume.get("detected_languages", [])
            all_cached_questions = cached_resume.get("questions", [])
            session_questions = await _freshen_questions_for_user(
                db=db,
                user_id=current_user["id"],
                questions=all_cached_questions,
                session_id=f"{current_user['id']}_cache",
            )

            # Increment cache hit counter
            db.resume_question_cache.update_one(
                {"_id": cached_resume["_id"]},
                {"$set": {"times_served": cached_resume.get("times_served", 0) + 1}}
            )

            # Create session from cached data
            session_data = {
                "user_id": current_user["id"],
                "username": current_user["username"],
                "resume_file": file.filename,
                "resume_path": file_path,
                "resume_hash": resume_hash,
                "skills": limited_topics,
                "all_skills": all_skills,
                "experience": experience,
                "detected_languages": detected_languages,
                "questions": session_questions,
                "all_questions": session_questions,
                "created_at": datetime.now(),
                "status": "in_progress",
                "session_type": "resume-guided"
            }
            session_result = db.user_sessions.insert_one(session_data)
            session_id = str(session_result.inserted_id)

            logger.info(f"Session created from cache: {session_id} with {len(limited_topics)} topics (questions on-demand)")

            return {
                "success": True,
                "session_id": session_id,
                "skills": limited_topics,
                "topicsDetected": limited_topics,
                "all_skills": all_skills,
                "experience": experience,
                "detected_languages": detected_languages,
                "has_coding_topics": len(detected_languages) > 0,
                "message": f"Resume processed! Found {len(limited_topics)} topics. Click a topic to generate questions."
            }

        # --- Cache MISS: generate questions via AI pipeline ---
        logger.info(f"Resume cache MISS for hash={resume_hash[:12]}..., generating via AI pipeline")
        
        # Generate questions using interview_rag_pipeline off the main thread
        try:
            # Run the blocking pipeline in a separate thread to keep server responsive
            result = await run_in_threadpool(interview_rag_pipeline, file_path, get_rag_collection())
            
            if not result:
                raise HTTPException(
                    status_code=500,
                    detail="Failed to generate questions from resume"
                )

            # Normalize questions from either `questions` or `sections`
            questions = result.get("questions")
            if not questions and result.get("sections"):
                questions = []
                for section in result.get("sections", []):
                    section_topic = section.get("title", "Misc")
                    for q in section.get("questions", []):
                        question_topic = q.get("topic") or section_topic
                        questions.append({
                            "id": q.get("id"),
                            "question": q.get("q") or q.get("question"),
                            "answer": q.get("a") or q.get("answer"),
                            "topic": question_topic,
                            "difficulty": q.get("difficulty"),
                            "code": q.get("code"),
                            "complexity": q.get("complexity"),
                            "examples": q.get("examples"),
                            "constraints": q.get("constraints"),
                            "type": q.get("type"),  # "coding" or "analytical"
                            "language": q.get("language"),  # "python", "java", etc.
                            "starter_code": q.get("starter_code"),
                            "test_cases": q.get("test_cases"),  # [{input, expected_output}]
                        })

            if not questions:
                raise HTTPException(
                    status_code=500,
                    detail="Failed to generate questions from resume"
                )
            
            # Limit topics to top 4-5 for focused practice
            limited_topics = _get_top_topics(questions, result.get("skills", []), limit=5)
            
            # Auto-detect programming languages from resume
            detected_languages = _detect_programming_languages(questions, result.get("skills", []))

            # --- Store in resume question cache for future reuse (Approach 3A+3C) ---
            try:
                experience_text = result.get("experience", "")
                all_skills = result.get("skills", [])
                semantic_hash = _semantic_resume_hash(all_skills, experience_text)
                
                db.resume_question_cache.insert_one({
                    "user_id": current_user["id"],
                    "resume_hash": resume_hash,  # Exact byte match
                    "semantic_hash": semantic_hash,  # Semantic content match (Approach 3A)
                    "skills": limited_topics,
                    "all_skills": all_skills,
                    "experience": experience_text,
                    "questions": questions,
                    "detected_languages": detected_languages,
                    "questionVersion": result.get("questionVersion", 3),
                    "questionsSource": result.get("questionsSource", "resume-ai"),
                    "created_at": datetime.now(),  # For TTL expiration check (Approach 3C)
                    "expires_at": datetime.now() + timedelta(days=90),  # Explicit TTL
                    "times_served": 0,
                })
                logger.info(f"Resume cached (90-day TTL). Languages: {detected_languages}")
            except Exception as cache_err:
                logger.warning(f"Failed to cache resume questions: {cache_err}")

            # Ensure this user gets a fresh set versus prior sessions.
            session_questions = await _freshen_questions_for_user(
                db=db,
                user_id=current_user["id"],
                questions=questions,
                session_id=f"{current_user['id']}_new",
            )

            # Create session in MongoDB (topics only, questions on-demand)
            session_data = {
                "user_id": current_user["id"],
                "username": current_user["username"],
                "resume_file": file.filename,
                "resume_path": file_path,
                "resume_hash": resume_hash,
                "skills": limited_topics,
                "all_skills": result.get("skills", []),
                "experience": result.get("experience", ""),
                "detected_languages": detected_languages,
                "questions": session_questions,
                "all_questions": session_questions,  # Store all questions for section-based generation
                "created_at": datetime.now(),
                "status": "in_progress",
                "session_type": "resume-guided"
            }
            
            session_result = db.user_sessions.insert_one(session_data)
            session_id = str(session_result.inserted_id)
            
            logger.info(f"Session created: {session_id} with {len(limited_topics)} topics, {len(detected_languages)} programming languages")
            
            return {
                "success": True,
                "session_id": session_id,
                "skills": limited_topics,
                "topicsDetected": limited_topics,
                "all_skills": result.get("skills", []),
                "experience": result.get("experience", ""),
                "detected_languages": detected_languages,
                "has_coding_topics": len(detected_languages) > 0,
                "message": f"Resume processed! Found {len(limited_topics)} topics. Click a topic to generate questions."
            }
            
        except Exception as e:
            logger.error(f"Error in interview_rag_pipeline: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to process resume: {str(e)}"
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload error: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to upload resume: {str(e)}"
        )

@app.get("/resume-questions")
async def get_resume_questions(
    topic: Optional[str] = None,
    difficulty: Optional[str] = None,
    limit: Optional[int] = 50,
    current_user: Dict = Depends(get_current_user)
):
    """
    Get resume-based questions filtered by topic/difficulty from latest session
    """
    try:
        db = get_db()

        latest_session = db.user_sessions.find_one(
            {"user_id": current_user["id"]},
            sort=[("created_at", -1)]
        )

        if not latest_session:
            return {"questions": [], "total_available": 0}

        questions = latest_session.get("questions") or latest_session.get("all_questions", [])

        filtered_questions = questions
        if topic:
            normalized_topic = topic.strip().lower()
            filtered_questions = [
                q for q in filtered_questions
                if (q.get("topic") or "").strip().lower() == normalized_topic
                or normalized_topic in (q.get("question") or "").lower()
                or normalized_topic in (q.get("answer") or "").lower()
            ]

        if difficulty:
            normalized_diff = difficulty.strip().lower()
            if normalized_diff == "coding":
                filtered_questions = [
                    q for q in filtered_questions
                    if (q.get("type") or "").strip().lower() == "coding"
                ]
            else:
                filtered_questions = [
                    q for q in filtered_questions
                    if (q.get("difficulty") or "").strip().lower() == normalized_diff
                ]

        if topic or difficulty:
            questions = filtered_questions

        min_required = 5 if difficulty else 0
        existing_questions = { (q.get("question") or "").strip().lower() for q in questions }
        existing_questions |= _collect_user_seen_questions(db, current_user["id"])

        if min_required and len(questions) < min_required:
            questions.extend(
                _generate_topic_questions(
                    topic,
                    difficulty,
                    min_required - len(questions),
                    existing_questions,
                    session_id=str(latest_session.get("_id"))
                )
            )

        if limit is not None and limit > 0:
            effective_limit = max(limit, min_required) if min_required else limit
            questions = questions[:effective_limit]

        return {
            "session_id": str(latest_session.get("_id")),
            "questions": questions,
            "total_available": len(questions)
        }

    except Exception as e:
        logger.error(f"Error fetching resume questions: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch resume questions: {str(e)}"
        )

@app.post("/generate-test-questions")
async def generate_test_questions(
    payload: GenerateTestQuestionsRequest,
    current_user: Dict = Depends(get_current_user)
):
    """
    Generate additional test questions for a session
    """
    try:
        db = get_db()
        
        # Try to import ObjectId, fall back to mock
        try:
            from bson import ObjectId
            make_object_id = ObjectId
        except:
            from backend.db.mock_mongo import MockObjectId
            make_object_id = MockObjectId

        session = None
        if payload.session_id:
            session = db.user_sessions.find_one({"_id": make_object_id(payload.session_id)})
            if not session:
                raise HTTPException(status_code=404, detail="Session not found")
        else:
            session = db.user_sessions.find_one(
                {"user_id": current_user["id"]},
                sort=[("created_at", -1)]
            )

        if not session:
            return {
                "session_id": None,
                "questions": [],
                "total_available": 0,
                "message": "No session found"
            }

        if session["user_id"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Not authorized")

        questions = session.get("questions") or session.get("all_questions", [])

        filtered_questions = questions
        if payload.topic:
            normalized_topic = payload.topic.strip().lower()
            filtered_questions = [
                q for q in filtered_questions
                if (q.get("topic") or "").strip().lower() == normalized_topic
                or normalized_topic in (q.get("question") or "").lower()
                or normalized_topic in (q.get("answer") or "").lower()
            ]

        if payload.difficulty:
            normalized_diff = payload.difficulty.strip().lower()
            if normalized_diff == "coding":
                filtered_questions = [
                    q for q in filtered_questions
                    if (q.get("type") or "").strip().lower() == "coding"
                ]
            else:
                filtered_questions = [
                    q for q in filtered_questions
                    if (q.get("difficulty") or "").strip().lower() == normalized_diff
                ]

        if payload.topic or payload.difficulty:
            questions = filtered_questions

        num_questions = payload.num_questions or 10
        min_required = 5 if payload.difficulty else 0
        target_count = max(num_questions, min_required) if min_required else num_questions

        existing_questions = {(q.get("question") or "").strip().lower() for q in questions}
        existing_questions |= _collect_user_seen_questions(db, current_user["id"])
        if target_count and len(questions) < target_count:
            questions.extend(
                await _generate_questions_parallel_with_backfill(
                    topic=payload.topic,
                    difficulty=payload.difficulty,
                    needed_count=target_count - len(questions),
                    existing_questions=existing_questions,
                    session_id=str(session.get("_id")),
                )
            )

        return {
            "session_id": str(session.get("_id")),
            "questions": questions[:target_count],
            "total_available": len(questions)
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating questions: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate questions: {str(e)}"
        )

@app.post("/evaluate")
async def evaluate_answer(
    question_answer: QuestionAnswer,
    current_user: Dict = Depends(get_current_user)
):
    """
    Evaluate a single answer
    """
    try:
        # Use simple evaluation function
        evaluation = simple_evaluate_answer(
            question_answer.question,
            question_answer.user_answer,
            question_answer.correct_answer or ""
        )
        
        return {
            "score": evaluation.get("score", 0),
            "feedback": evaluation.get("feedback", ""),
            "is_correct": evaluation.get("is_correct", False)
        }
        
    except Exception as e:
        logger.error(f"Evaluation error: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to evaluate answer: {str(e)}"
        )

@app.get("/get-session-topics")
async def get_session_topics(
    session_id: str,
    current_user: Dict = Depends(get_current_user)
):
    """
    Get topics and metadata for a session (for topic dashboard).
    Returns topics, detected languages, and session info.
    """
    try:
        db = get_db()
        
        # Try to import ObjectId, fall back to mock
        try:
            from bson import ObjectId
            session_id_obj = ObjectId(session_id)
        except:
            from backend.db.mock_mongo import MockObjectId
            session_id_obj = MockObjectId(session_id)
        
        # Get session
        session = db.user_sessions.find_one({"_id": session_id_obj})
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        
        # Verify user owns session
        if session["user_id"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Not authorized")
        
        return {
            "success": True,
            "session_id": session_id,
            "topics": session.get("skills", []),
            "detected_languages": session.get("detected_languages", []),
            "experience": session.get("experience", ""),
            "all_skills": session.get("all_skills", []),
            "resume_file": session.get("resume_file", ""),
            "has_coding_section": len(session.get("detected_languages", [])) > 0,
            "message": "Topics loaded successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching session topics: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch topics: {str(e)}"
        )

@app.post("/generate-section-questions")
async def generate_section_questions(
    session_id: str,
    topic: str,
    difficulty: str = "medium",
    num_questions: int = 8,
    current_user: Dict = Depends(get_current_user)
):
    """
    Generate questions for a specific topic and difficulty level.
    Called when user clicks on a section in the Topic Dashboard.
    """
    try:
        db = get_db()
        
        # Try to import ObjectId, fall back to mock
        try:
            from bson import ObjectId
            session_id_obj = ObjectId(session_id)
        except:
            from backend.db.mock_mongo import MockObjectId
            session_id_obj = MockObjectId(session_id)
        
        # Get session
        session = db.user_sessions.find_one({"_id": session_id_obj})
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        
        # Verify user owns session
        if session["user_id"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Not authorized")
        
        # Get all cached questions from the session
        all_questions = session.get("all_questions", [])
        
        # Filter questions by topic and difficulty
        filtered_questions = []
        for q in all_questions:
            q_topic = (q.get("topic") or "").strip().lower()
            q_difficulty = (q.get("difficulty") or "").strip().lower()
            target_topic = topic.strip().lower()
            target_difficulty = difficulty.strip().lower()
            
            if q_topic == target_topic and q_difficulty == target_difficulty:
                filtered_questions.append(q)
        
        # If not enough questions from cache, generate more
        existing_questions = {(q.get("question") or "").strip().lower() for q in filtered_questions}
        existing_questions |= _collect_user_seen_questions(db, current_user["id"])
        
        if len(filtered_questions) < num_questions:
            generated_count = num_questions - len(filtered_questions)
            new_questions = _generate_topic_questions(
                topic=topic,
                difficulty=difficulty,
                count=generated_count,
                existing_questions=existing_questions,
                session_id=str(session.get("_id"))
            )
            filtered_questions.extend(new_questions)
        
        # Return the generated questions
        return {
            "success": True,
            "session_id": session_id,
            "topic": topic,
            "difficulty": difficulty,
            "questions": filtered_questions[:num_questions],
            "total_available": len(filtered_questions),
            "message": f"Generated {len(filtered_questions[:num_questions])} questions for {topic} ({difficulty})"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating section questions: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate questions: {str(e)}"
        )

@app.post("/regenerate-question")
async def regenerate_question(
    session_id: str,
    question_index: int,
    current_user: Dict = Depends(get_current_user)
):
    """
    Regenerate a single question at the specified index while keeping others unchanged.
    """
    try:
        db = get_db()
        
        # Try to import ObjectId, fall back to mock
        try:
            from bson import ObjectId
            session_id_obj = ObjectId(session_id)
        except:
            from backend.db.mock_mongo import MockObjectId
            session_id_obj = MockObjectId(session_id)
        
        # Get session
        session = db.user_sessions.find_one({"_id": session_id_obj})
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        
        # Verify user owns session
        if session["user_id"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Not authorized")
        
        questions = session.get("questions", [])
        
        # Validate question index
        if question_index < 0 or question_index >= len(questions):
            raise HTTPException(status_code=400, detail="Invalid question index")
        
        # Get the question to replace
        old_question = questions[question_index]
        topic = old_question.get("topic") or "General"
        difficulty = old_question.get("difficulty") or "Medium"
        
        # Collect existing question texts to avoid duplicates
        existing_questions = {(q.get("question") or "").strip().lower() for q in questions}
        
        # Generate a new question for the same topic and difficulty
        new_questions = _generate_topic_questions(
            topic=topic,
            difficulty=difficulty,
            count=1,
            existing_questions=existing_questions,
            session_id=str(session.get("_id"))
        )
        
        if not new_questions:
            raise HTTPException(status_code=500, detail="Failed to generate new question")
        
        # Replace only the specific question
        new_question = new_questions[0]
        questions[question_index] = new_question
        
        # Update session in database
        db.user_sessions.update_one(
            {"_id": session_id_obj},
            {"$set": {"questions": questions}}
        )
        
        logger.info(f"Question {question_index} regenerated for session {session_id}")
        
        return {
            "success": True,
            "question_index": question_index,
            "new_question": new_question,
            "message": f"Question regenerated successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error regenerating question: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to regenerate question: {str(e)}"
        )

# --- Language mapping for Piston API ---
PISTON_LANG_MAP = {
    "python": {"language": "python", "version": "3.10.0"},
    "java": {"language": "java", "version": "15.0.2"},
    "cpp": {"language": "c++", "version": "10.2.0"},
    "c++": {"language": "c++", "version": "10.2.0"},
    "javascript": {"language": "javascript", "version": "18.15.0"},
    "js": {"language": "javascript", "version": "18.15.0"},
    "c": {"language": "c", "version": "10.2.0"},
    "typescript": {"language": "typescript", "version": "5.0.3"},
    "sql": {"language": "sql", "version": "0"},
}

# Compiled languages that should early-bail on compile errors
_COMPILED_LANGS = {"java", "cpp", "c++", "c", "typescript"}

PISTON_URL = "https://emkc.org/api/v2/piston/execute"


async def _execute_single(
    client: Any, lang_info: dict, lang_key: str,
    code: str, stdin_input: str, expected: str, index: int
) -> dict:
    """Execute a single test case against Piston and return the result dict."""
    try:
        resp = await client.post(
            PISTON_URL,
            json={
                "language": lang_info["language"],
                "version": lang_info["version"],
                "files": [{"name": f"solution.{_get_file_ext(lang_key)}", "content": code}],
                "stdin": stdin_input,
                "run_timeout": 10000,
                "compile_timeout": 15000,
            },
        )

        if resp.status_code != 200:
            return {
                "test_case": index, "input": stdin_input, "expected": expected,
                "actual": "", "passed": False,
                "error": f"Execution service error (HTTP {resp.status_code})",
                "_compile_error": False,
            }

        data = resp.json()
        run_data = data.get("run", {})
        compile_data = data.get("compile", {})

        # Compile error
        if compile_data.get("stderr"):
            return {
                "test_case": index, "input": stdin_input, "expected": expected,
                "actual": "", "passed": False,
                "error": compile_data["stderr"][:500],
                "_compile_error": True,
            }

        actual_output = (run_data.get("stdout") or "").strip()
        stderr = (run_data.get("stderr") or "").strip()

        if stderr and not actual_output:
            return {
                "test_case": index, "input": stdin_input, "expected": expected,
                "actual": "", "passed": False,
                "error": stderr[:500], "_compile_error": False,
            }

        passed = (actual_output == expected) if expected else True
        return {
            "test_case": index, "input": stdin_input, "expected": expected,
            "actual": actual_output, "passed": passed,
            "error": stderr[:200] if stderr else None,
            "_compile_error": False,
        }

    except Exception as e:
        if httpx and hasattr(httpx, "TimeoutException") and isinstance(e, httpx.TimeoutException):
            return {
                "test_case": index, "input": stdin_input, "expected": expected,
                "actual": "", "passed": False,
                "error": "Time Limit Exceeded (10s)", "_compile_error": False,
            }
        return {
            "test_case": index, "input": stdin_input, "expected": expected,
            "actual": "", "passed": False,
            "error": str(e)[:300], "_compile_error": False,
        }


def _normalize_output(text: str) -> str:
    return "\n".join(line.rstrip() for line in (text or "").strip().splitlines()).strip()


def _execute_python_local(code: str, stdin_input: str, expected: str, index: int) -> dict:
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as tmp:
            tmp.write(code)
            tmp_path = tmp.name
        proc = subprocess.run(
            [sys.executable, tmp_path],
            input=stdin_input or "",
            capture_output=True,
            text=True,
            timeout=8,
        )
        if proc.returncode != 0:
            return {
                "test_case": index, "input": stdin_input, "expected": expected,
                "actual": "", "passed": False,
                "error": (proc.stderr or "Runtime error").strip()[:500],
                "_compile_error": False,
            }
        actual = _normalize_output(proc.stdout)
        passed = (actual == expected) if expected else True
        return {
            "test_case": index, "input": stdin_input, "expected": expected,
            "actual": actual, "passed": passed, "error": None, "_compile_error": False,
        }
    except subprocess.TimeoutExpired:
        return {
            "test_case": index, "input": stdin_input, "expected": expected,
            "actual": "", "passed": False,
            "error": "Time Limit Exceeded (8s)", "_compile_error": False,
        }
    except Exception as e:
        return {
            "test_case": index, "input": stdin_input, "expected": expected,
            "actual": "", "passed": False,
            "error": str(e)[:300], "_compile_error": False,
        }
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass


def _execute_sql_local(query: str, tc: Dict[str, str], index: int) -> dict:
    setup_sql = tc.get("setup_sql") or ""
    expected = _normalize_output(tc.get("expected_output", ""))
    conn: Optional[sqlite3.Connection] = None
    try:
        conn = sqlite3.connect(":memory:")
        cur = conn.cursor()
        if setup_sql.strip():
            cur.executescript(setup_sql)
        cur.execute(query)
        rows = cur.fetchall()
        actual_lines = ["|".join("" if v is None else str(v) for v in row) for row in rows]
        actual = _normalize_output("\n".join(actual_lines))
        passed = (actual == expected) if expected else True
        return {
            "test_case": index,
            "input": tc.get("input", ""),
            "expected": expected,
            "actual": actual,
            "passed": passed,
            "error": None,
            "_compile_error": False,
        }
    except Exception as e:
        return {
            "test_case": index,
            "input": tc.get("input", ""),
            "expected": expected,
            "actual": "",
            "passed": False,
            "error": f"SQL error: {str(e)[:300]}",
            "_compile_error": False,
        }
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def _cmd_exists(cmd: str) -> bool:
    return bool(shutil.which(cmd))


def _run_local_process(command: List[str], stdin_input: str = "", timeout: int = 10, cwd: Optional[str] = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        command,
        input=stdin_input or "",
        capture_output=True,
        text=True,
        timeout=timeout,
        cwd=cwd,
    )


def _execute_javascript_local(code: str, stdin_input: str, expected: str, index: int) -> dict:
    if not _cmd_exists("node"):
        return {
            "test_case": index, "input": stdin_input, "expected": expected, "actual": "",
            "passed": False, "error": "Node.js is not installed on the server", "_compile_error": False,
        }
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as tmp:
            tmp.write(code)
            tmp_path = tmp.name
        proc = _run_local_process(["node", tmp_path], stdin_input=stdin_input, timeout=8)
        if proc.returncode != 0:
            return {
                "test_case": index, "input": stdin_input, "expected": expected, "actual": "",
                "passed": False, "error": (proc.stderr or "Runtime error").strip()[:500], "_compile_error": False,
            }
        actual = _normalize_output(proc.stdout)
        return {
            "test_case": index, "input": stdin_input, "expected": expected, "actual": actual,
            "passed": (actual == expected) if expected else True, "error": None, "_compile_error": False,
        }
    except subprocess.TimeoutExpired:
        return {
            "test_case": index, "input": stdin_input, "expected": expected, "actual": "",
            "passed": False, "error": "Time Limit Exceeded (8s)", "_compile_error": False,
        }
    except Exception as e:
        return {
            "test_case": index, "input": stdin_input, "expected": expected, "actual": "",
            "passed": False, "error": str(e)[:300], "_compile_error": False,
        }
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass


def _execute_c_family_local(lang_key: str, code: str, stdin_input: str, expected: str, index: int) -> dict:
    compiler = "g++" if lang_key in {"cpp", "c++"} else "gcc"
    if not _cmd_exists(compiler):
        return {
            "test_case": index, "input": stdin_input, "expected": expected, "actual": "",
            "passed": False, "error": f"{compiler} is not installed on the server", "_compile_error": False,
        }
    tmp_dir = tempfile.mkdtemp(prefix="code_run_")
    source_ext = "cpp" if lang_key in {"cpp", "c++"} else "c"
    source_path = os.path.join(tmp_dir, f"main.{source_ext}")
    exe_path = os.path.join(tmp_dir, "main_exec")
    try:
        with open(source_path, "w", encoding="utf-8") as f:
            f.write(code)
        compile_cmd = [compiler, source_path, "-O2", "-o", exe_path]
        if lang_key in {"cpp", "c++"}:
            compile_cmd.insert(2, "-std=c++17")
        else:
            compile_cmd.insert(2, "-std=c11")
        cproc = _run_local_process(compile_cmd, timeout=12)
        if cproc.returncode != 0:
            return {
                "test_case": index, "input": stdin_input, "expected": expected, "actual": "",
                "passed": False, "error": (cproc.stderr or "Compilation failed").strip()[:500], "_compile_error": True,
            }
        rproc = _run_local_process([exe_path], stdin_input=stdin_input, timeout=8)
        if rproc.returncode != 0:
            return {
                "test_case": index, "input": stdin_input, "expected": expected, "actual": "",
                "passed": False, "error": (rproc.stderr or "Runtime error").strip()[:500], "_compile_error": False,
            }
        actual = _normalize_output(rproc.stdout)
        return {
            "test_case": index, "input": stdin_input, "expected": expected, "actual": actual,
            "passed": (actual == expected) if expected else True, "error": None, "_compile_error": False,
        }
    except subprocess.TimeoutExpired:
        return {
            "test_case": index, "input": stdin_input, "expected": expected, "actual": "",
            "passed": False, "error": "Time Limit Exceeded", "_compile_error": False,
        }
    except Exception as e:
        return {
            "test_case": index, "input": stdin_input, "expected": expected, "actual": "",
            "passed": False, "error": str(e)[:300], "_compile_error": False,
        }
    finally:
        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:
            pass


def _extract_java_class_name(code: str) -> Optional[str]:
    m = re.search(r"public\s+class\s+([A-Za-z_]\w*)", code)
    if m:
        return m.group(1)
    m = re.search(r"class\s+([A-Za-z_]\w*)", code)
    if m:
        return m.group(1)
    return None


def _execute_java_local(code: str, stdin_input: str, expected: str, index: int) -> dict:
    if not _cmd_exists("javac") or not _cmd_exists("java"):
        return {
            "test_case": index, "input": stdin_input, "expected": expected, "actual": "",
            "passed": False, "error": "Java JDK is not installed on the server", "_compile_error": False,
        }
    class_name = _extract_java_class_name(code)
    if not class_name:
        return {
            "test_case": index, "input": stdin_input, "expected": expected, "actual": "",
            "passed": False, "error": "Java code must contain a class declaration (e.g., public class Main)", "_compile_error": True,
        }

    tmp_dir = tempfile.mkdtemp(prefix="java_run_")
    source_path = os.path.join(tmp_dir, f"{class_name}.java")
    try:
        with open(source_path, "w", encoding="utf-8") as f:
            f.write(code)
        cproc = _run_local_process(["javac", source_path], timeout=14, cwd=tmp_dir)
        if cproc.returncode != 0:
            return {
                "test_case": index, "input": stdin_input, "expected": expected, "actual": "",
                "passed": False, "error": (cproc.stderr or "Compilation failed").strip()[:500], "_compile_error": True,
            }
        rproc = _run_local_process(["java", "-cp", tmp_dir, class_name], stdin_input=stdin_input, timeout=8, cwd=tmp_dir)
        if rproc.returncode != 0:
            return {
                "test_case": index, "input": stdin_input, "expected": expected, "actual": "",
                "passed": False, "error": (rproc.stderr or "Runtime error").strip()[:500], "_compile_error": False,
            }
        actual = _normalize_output(rproc.stdout)
        return {
            "test_case": index, "input": stdin_input, "expected": expected, "actual": actual,
            "passed": (actual == expected) if expected else True, "error": None, "_compile_error": False,
        }
    except subprocess.TimeoutExpired:
        return {
            "test_case": index, "input": stdin_input, "expected": expected, "actual": "",
            "passed": False, "error": "Time Limit Exceeded", "_compile_error": False,
        }
    except Exception as e:
        return {
            "test_case": index, "input": stdin_input, "expected": expected, "actual": "",
            "passed": False, "error": str(e)[:300], "_compile_error": False,
        }
    finally:
        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:
            pass


def _execute_local_by_language(lang_key: str, code: str, stdin_input: str, expected: str, index: int) -> dict:
    if lang_key == "python":
        return _execute_python_local(code, stdin_input, expected, index)
    if lang_key == "sql":
        return {
            "test_case": index, "input": stdin_input, "expected": expected, "actual": "",
            "passed": False, "error": "Internal error: SQL local dispatcher mismatch", "_compile_error": False,
        }
    if lang_key in {"javascript", "js"}:
        return _execute_javascript_local(code, stdin_input, expected, index)
    if lang_key in {"c", "cpp", "c++"}:
        return _execute_c_family_local(lang_key, code, stdin_input, expected, index)
    if lang_key == "java":
        return _execute_java_local(code, stdin_input, expected, index)
    return {
        "test_case": index, "input": stdin_input, "expected": expected, "actual": "",
        "passed": False, "error": f"Local execution not supported for {lang_key}", "_compile_error": False,
    }


def _compile_check_local(lang_key: str, code: str, test_cases: List[Dict[str, str]]) -> Optional[Dict[str, Any]]:
    if lang_key == "python":
        try:
            compile(code, "<user_code>", "exec")
            return {"success": True, "language": "python", "compile_ok": True, "message": "Compilation successful"}
        except Exception as ce:
            return {"success": True, "language": "python", "compile_ok": False, "message": str(ce)}
    if lang_key == "sql":
        tc = test_cases[0] if test_cases else {"setup_sql": "", "expected_output": ""}
        res = _execute_sql_local(code, tc, 1)
        return {
            "success": True,
            "language": "sql",
            "compile_ok": res.get("error") is None,
            "message": "SQL syntax looks valid" if res.get("error") is None else res.get("error"),
        }
    if lang_key in {"javascript", "js"}:
        if not _cmd_exists("node"):
            return {"success": True, "language": lang_key, "compile_ok": False, "message": "Node.js is not installed on the server"}
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as tmp:
                tmp.write(code)
                tmp_path = tmp.name
            proc = _run_local_process(["node", "--check", tmp_path], timeout=8)
            return {
                "success": True,
                "language": lang_key,
                "compile_ok": proc.returncode == 0,
                "message": "Compilation successful" if proc.returncode == 0 else (proc.stderr or "Syntax error").strip()[:500],
            }
        except Exception as e:
            return {"success": True, "language": lang_key, "compile_ok": False, "message": str(e)}
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass
    if lang_key in {"c", "cpp", "c++"}:
        compiler = "g++" if lang_key in {"cpp", "c++"} else "gcc"
        if not _cmd_exists(compiler):
            return {"success": True, "language": lang_key, "compile_ok": False, "message": f"{compiler} is not installed on the server"}
        tmp_dir = tempfile.mkdtemp(prefix="compile_")
        source_ext = "cpp" if lang_key in {"cpp", "c++"} else "c"
        source_path = os.path.join(tmp_dir, f"main.{source_ext}")
        exe_path = os.path.join(tmp_dir, "main_exec")
        try:
            with open(source_path, "w", encoding="utf-8") as f:
                f.write(code)
            compile_cmd = [compiler, source_path, "-O2", "-o", exe_path]
            compile_cmd.insert(2, "-std=c++17" if lang_key in {"cpp", "c++"} else "-std=c11")
            proc = _run_local_process(compile_cmd, timeout=12)
            return {
                "success": True,
                "language": lang_key,
                "compile_ok": proc.returncode == 0,
                "message": "Compilation successful" if proc.returncode == 0 else (proc.stderr or "Compilation failed").strip()[:500],
            }
        except Exception as e:
            return {"success": True, "language": lang_key, "compile_ok": False, "message": str(e)}
        finally:
            try:
                shutil.rmtree(tmp_dir, ignore_errors=True)
            except Exception:
                pass
    if lang_key == "java":
        if not _cmd_exists("javac"):
            return {"success": True, "language": "java", "compile_ok": False, "message": "javac is not installed on the server"}
        class_name = _extract_java_class_name(code)
        if not class_name:
            return {"success": True, "language": "java", "compile_ok": False, "message": "Java code must contain a class declaration (e.g., public class Main)"}
        tmp_dir = tempfile.mkdtemp(prefix="java_compile_")
        source_path = os.path.join(tmp_dir, f"{class_name}.java")
        try:
            with open(source_path, "w", encoding="utf-8") as f:
                f.write(code)
            proc = _run_local_process(["javac", source_path], timeout=14, cwd=tmp_dir)
            return {
                "success": True,
                "language": "java",
                "compile_ok": proc.returncode == 0,
                "message": "Compilation successful" if proc.returncode == 0 else (proc.stderr or "Compilation failed").strip()[:500],
            }
        except Exception as e:
            return {"success": True, "language": "java", "compile_ok": False, "message": str(e)}
        finally:
            try:
                shutil.rmtree(tmp_dir, ignore_errors=True)
            except Exception:
                pass
    return None


@app.post("/run-code")
async def run_code(
    payload: RunCodeRequest,
    current_user: Dict = Depends(get_current_user)
):
    """
    Execute code against test cases.
    - Primary runner: external Piston-like service.
    - Fallback: local Python execution when external runner is unavailable/unauthorized.
    - SQL: local sqlite execution with per-test setup_sql + expected_output.
    """
    start_time = time.time()

    lang_key = payload.language.strip().lower()
    compile_only = bool(payload.compile_only)
    lang_info = PISTON_LANG_MAP.get(lang_key)
    if not lang_info:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported language: {payload.language}. Supported: {', '.join(PISTON_LANG_MAP.keys())}"
        )

    test_cases = payload.test_cases or []
    if lang_key == "sql" and not test_cases:
        test_cases = [{
            "setup_sql": "CREATE TABLE t(a INTEGER); INSERT INTO t VALUES (1),(2);",
            "expected_output": "",
        }]
    elif not test_cases:
        test_cases = [{"input": "", "expected_output": ""}]

    if compile_only:
        local_compile = _compile_check_local(lang_key, payload.code, test_cases)
        if local_compile is not None:
            return local_compile
        return {"success": True, "language": lang_key, "compile_ok": True, "message": "Compile check is not configured for this language."}

    results: List[Dict[str, Any]] = []
    is_compiled = lang_key in _COMPILED_LANGS

    if lang_key == "sql":
        for i, tc in enumerate(test_cases, start=1):
            results.append(_execute_sql_local(payload.code, tc, i))
    elif httpx is None:
        if lang_key in {"python", "java", "c", "cpp", "c++", "javascript", "js"}:
            for i, tc in enumerate(test_cases, start=1):
                results.append(
                    _execute_local_by_language(
                        lang_key,
                        payload.code,
                        tc.get("input", ""),
                        _normalize_output(tc.get("expected_output", "")),
                        i,
                    )
                )
        else:
            raise HTTPException(status_code=503, detail="Execution service unavailable for this language")
    else:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(60.0, connect=10.0),
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        ) as client:

            if is_compiled and len(test_cases) > 1:
                first_tc = test_cases[0]
                first_result = await _execute_single(
                    client, lang_info, lang_key, payload.code,
                    first_tc.get("input", ""),
                    first_tc.get("expected_output", "").strip(),
                    1,
                )
                results.append(first_result)

                if first_result.get("_compile_error"):
                    for i, tc in enumerate(test_cases[1:], start=2):
                        results.append({
                            "test_case": i,
                            "input": tc.get("input", ""),
                            "expected": tc.get("expected_output", "").strip(),
                            "actual": "",
                            "passed": False,
                            "error": first_result["error"],
                            "_compile_error": True,
                        })
                else:
                    tasks = [
                        _execute_single(
                            client, lang_info, lang_key, payload.code,
                            tc.get("input", ""),
                            tc.get("expected_output", "").strip(),
                            i,
                        )
                        for i, tc in enumerate(test_cases[1:], start=2)
                    ]
                    results.extend(await asyncio.gather(*tasks))
            else:
                tasks = [
                    _execute_single(
                        client, lang_info, lang_key, payload.code,
                        tc.get("input", ""),
                        tc.get("expected_output", "").strip(),
                        i,
                    )
                    for i, tc in enumerate(test_cases, start=1)
                ]
                results = list(await asyncio.gather(*tasks))

        def _has_http_401_error(result_row: Dict[str, Any]) -> bool:
            err_val = result_row.get("error")
            return isinstance(err_val, str) and ("HTTP 401" in err_val)

        external_auth_error = len(results) > 0 and all(
            (not bool(r.get("passed"))) and _has_http_401_error(r)
            for r in results
        )
        if external_auth_error and lang_key in {"python", "java", "c", "cpp", "c++", "javascript", "js"}:
            local_results: List[dict] = []
            for i, tc in enumerate(test_cases, start=1):
                local_results.append(
                    _execute_local_by_language(
                        lang_key,
                        payload.code,
                        tc.get("input", ""),
                        _normalize_output(tc.get("expected_output", "")),
                        i,
                    )
                )
            results = local_results

    for r in results:
        r.pop("_compile_error", None)

    results.sort(key=lambda r: r["test_case"])

    total = len(results)
    passed_count = sum(1 for r in results if r["passed"])
    elapsed_ms = round((time.time() - start_time) * 1000)

    return {
        "results": results,
        "total": total,
        "passed": passed_count,
        "all_passed": passed_count == total,
        "score": round((passed_count / total) * 100) if total > 0 else 0,
        "execution_time_ms": elapsed_ms,
    }
def _get_file_ext(lang: str) -> str:
    """Return file extension for a language."""
    ext_map = {
        "python": "py", "java": "java", "cpp": "cpp", "c++": "cpp",
        "javascript": "js", "js": "js", "c": "c", "typescript": "ts", "sql": "sql",
    }
    return ext_map.get(lang, "txt")


def _build_session_object_id(session_id: str):
    try:
        from bson import ObjectId
        return ObjectId(session_id)
    except Exception:
        from backend.db.mock_mongo import MockObjectId
        return MockObjectId(session_id)


def _get_owned_session(db, session_id: str, current_user: Dict):
    session_id_obj = _build_session_object_id(session_id)
    session = db.user_sessions.find_one({"_id": session_id_obj})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.get("user_id") != current_user.get("id"):
        raise HTTPException(status_code=403, detail="Not authorized")
    return session_id_obj, session


def _get_session_by_bridge_token(db, bridge_token: str):
    if not bridge_token:
        raise HTTPException(status_code=400, detail="bridge_token is required")
    session = db.user_sessions.find_one({"vr_test.bridge_token": bridge_token})
    if not session:
        raise HTTPException(status_code=404, detail="Invalid bridge_token")
    vr_state = session.get("vr_test") or {}
    expires_at = vr_state.get("bridge_expires_at")
    if expires_at and datetime.now() > expires_at:
        raise HTTPException(status_code=401, detail="bridge_token expired")
    return session


@app.post("/vr-test/start")
async def start_vr_test(
    payload: VRStartRequest,
    current_user: Dict = Depends(get_current_user)
):
    """
    Initialize VR test state from already-generated questions.
    Reuses existing normal test questions (no regeneration).
    """
    db = get_db()
    session_id_obj, session = _get_owned_session(db, payload.session_id, current_user)

    source_questions = payload.questions or session.get("questions", [])
    vr_questions: List[Dict[str, Any]] = []
    default_topic = payload.topic or session.get("topic") or "General"
    default_difficulty = (payload.difficulty or session.get("difficulty") or "medium").lower()

    for idx, q in enumerate(source_questions):
        q_text = (q.get("question") or "").strip()
        if not q_text:
            continue
        vr_questions.append({
            "index": idx,
            "id": q.get("id") or f"vr_q_{idx+1}",
            "question": q_text,
            "answer": q.get("answer") or "",
            "topic": q.get("topic") or default_topic,
            "difficulty": (q.get("difficulty") or default_difficulty).lower(),
            "type": q.get("type") or "open",
        })

    if not vr_questions:
        raise HTTPException(status_code=400, detail="No questions available to start VR test")

    started_at = datetime.now()
    bridge_token = secrets.token_urlsafe(24)
    bridge_expires_at = started_at + timedelta(hours=6)
    vr_state = {
        "status": "in_progress",
        "started_at": started_at,
        "mode": "vr",
        "topic": default_topic,
        "difficulty": default_difficulty,
        "bridge_token": bridge_token,
        "bridge_expires_at": bridge_expires_at,
        "current_question_index": 0,
        "questions": vr_questions,
        "answers": [],
    }

    db.user_sessions.update_one(
        {"_id": session_id_obj},
        {
            "$set": {
                "status": "in_progress",
                "topic": default_topic,
                "difficulty": default_difficulty,
                "mode": "vr",
                "vr_test": vr_state,
            }
        }
    )

    return {
        "success": True,
        "session_id": payload.session_id,
        "mode": "vr",
        "total_questions": len(vr_questions),
        "bridge_token": bridge_token,
        "bridge_expires_at": bridge_expires_at.isoformat(),
        "current_question": vr_questions[0],
    }


@app.get("/vr-test/next")
async def get_vr_next_question(
    session_id: str,
    current_user: Dict = Depends(get_current_user)
):
    db = get_db()
    _, session = _get_owned_session(db, session_id, current_user)

    vr_state = session.get("vr_test") or {}
    questions = vr_state.get("questions") or []
    idx = int(vr_state.get("current_question_index", 0))

    if not questions:
        raise HTTPException(status_code=404, detail="VR test not initialized for this session")

    if idx >= len(questions):
        return {
            "success": True,
            "completed": True,
            "current_question": None,
            "current_question_index": idx,
            "total_questions": len(questions),
        }

    return {
        "success": True,
        "completed": False,
        "current_question_index": idx,
        "total_questions": len(questions),
        "current_question": questions[idx],
    }


@app.post("/vr-test/answer")
async def submit_vr_answer(
    payload: VRAnswerRequest,
    session_id: str,
    current_user: Dict = Depends(get_current_user)
):
    db = get_db()
    session_id_obj, session = _get_owned_session(db, session_id, current_user)

    vr_state = session.get("vr_test") or {}
    questions = vr_state.get("questions") or []
    answers = vr_state.get("answers") or []
    idx = int(vr_state.get("current_question_index", 0))

    if not questions:
        raise HTTPException(status_code=404, detail="VR test not initialized for this session")
    if idx >= len(questions):
        raise HTTPException(status_code=400, detail="VR test already completed")
    if payload.question_index != idx:
        raise HTTPException(
            status_code=409,
            detail=f"Expected answer for question_index={idx}, got {payload.question_index}"
        )

    q = questions[idx]
    evaluation = simple_evaluate_answer(
        q.get("question", ""),
        payload.user_answer,
        q.get("answer", ""),
    )

    answer_record = {
        "question_index": idx,
        "question": q.get("question", ""),
        "user_answer": payload.user_answer,
        "correct_answer": q.get("answer", ""),
        "score": evaluation.get("score", 0),
        "feedback": evaluation.get("feedback", ""),
        "is_correct": evaluation.get("is_correct", False),
        "submitted_at": datetime.now(),
    }
    answers.append(answer_record)
    next_idx = idx + 1

    db.user_sessions.update_one(
        {"_id": session_id_obj},
        {
            "$set": {
                "vr_test.answers": answers,
                "vr_test.current_question_index": next_idx,
            }
        }
    )

    running_avg = round(sum(a.get("score", 0) for a in answers) / len(answers), 2) if answers else 0
    done = next_idx >= len(questions)
    next_question = None if done else questions[next_idx]

    return {
        "success": True,
        "completed": done,
        "saved_answer": answer_record,
        "running_percentage": running_avg,
        "next_question_index": next_idx,
        "next_question": next_question,
        "total_questions": len(questions),
    }


@app.post("/vr-test/complete")
async def complete_vr_test(
    payload: VRCompleteRequest,
    current_user: Dict = Depends(get_current_user)
):
    db = get_db()
    session_id_obj, session = _get_owned_session(db, payload.session_id, current_user)

    vr_state = session.get("vr_test") or {}
    questions = vr_state.get("questions") or []
    answers = vr_state.get("answers") or []
    if not questions:
        raise HTTPException(status_code=404, detail="VR test not initialized for this session")

    total_score = sum(a.get("score", 0) for a in answers)
    max_score = len(questions) * 100
    percentage = (total_score / max_score * 100) if max_score > 0 else 0
    completed_at = datetime.now()
    difficulty_label = vr_state.get("difficulty") or session.get("difficulty") or "medium"
    derived_topic = vr_state.get("topic") or session.get("topic") or "General"

    db.user_sessions.update_one(
        {"_id": session_id_obj},
        {
            "$set": {
                "status": "completed",
                "mode": "vr",
                "completed_at": completed_at,
                "total_score": total_score,
                "max_score": max_score,
                "percentage": percentage,
                "evaluated_answers": answers,
                "topic": derived_topic,
                "difficulty": difficulty_label,
                "time_spent": payload.time_spent,
                "tab_switches": 0,
                "vr_test.status": "completed",
                "vr_test.completed_at": completed_at,
            },
            "$push": {
                "test_attempts": {
                    "completed_at": completed_at,
                    "percentage": percentage,
                    "topic": derived_topic,
                    "difficulty": difficulty_label,
                    "time_spent": payload.time_spent,
                    "tab_switches": 0,
                    "mode": "vr",
                }
            }
        }
    )

    return {
        "success": True,
        "session_id": payload.session_id,
        "mode": "vr",
        "answered": len(answers),
        "total_questions": len(questions),
        "total_score": total_score,
        "max_score": max_score,
        "percentage": round(percentage, 2),
        "evaluated_answers": answers,
    }


@app.get("/vr-bridge/next")
async def get_vr_bridge_next_question(bridge_token: str):
    db = get_db()
    session = _get_session_by_bridge_token(db, bridge_token)

    vr_state = session.get("vr_test") or {}
    questions = vr_state.get("questions") or []
    idx = int(vr_state.get("current_question_index", 0))

    if not questions:
        raise HTTPException(status_code=404, detail="VR test not initialized for this session")

    if idx >= len(questions):
        return {
            "success": True,
            "completed": True,
            "current_question": None,
            "current_question_index": idx,
            "total_questions": len(questions),
        }

    return {
        "success": True,
        "completed": False,
        "current_question_index": idx,
        "total_questions": len(questions),
        "current_question": questions[idx],
    }


@app.post("/vr-bridge/answer")
async def submit_vr_bridge_answer(
    payload: VRBridgeAnswerRequest,
    bridge_token: str,
):
    db = get_db()
    session = _get_session_by_bridge_token(db, bridge_token)
    session_id_obj = session["_id"]

    vr_state = session.get("vr_test") or {}
    questions = vr_state.get("questions") or []
    answers = vr_state.get("answers") or []
    idx = int(vr_state.get("current_question_index", 0))

    if not questions:
        raise HTTPException(status_code=404, detail="VR test not initialized for this session")
    if idx >= len(questions):
        raise HTTPException(status_code=400, detail="VR test already completed")
    if payload.question_index != idx:
        raise HTTPException(
            status_code=409,
            detail=f"Expected answer for question_index={idx}, got {payload.question_index}"
        )

    q = questions[idx]
    evaluation = simple_evaluate_answer(
        q.get("question", ""),
        payload.user_answer,
        q.get("answer", ""),
    )
    answer_record = {
        "question_index": idx,
        "question": q.get("question", ""),
        "user_answer": payload.user_answer,
        "correct_answer": q.get("answer", ""),
        "score": evaluation.get("score", 0),
        "feedback": evaluation.get("feedback", ""),
        "is_correct": evaluation.get("is_correct", False),
        "submitted_at": datetime.now(),
    }
    answers.append(answer_record)
    next_idx = idx + 1

    db.user_sessions.update_one(
        {"_id": session_id_obj},
        {
            "$set": {
                "vr_test.answers": answers,
                "vr_test.current_question_index": next_idx,
            }
        }
    )

    running_avg = round(sum(a.get("score", 0) for a in answers) / len(answers), 2) if answers else 0
    done = next_idx >= len(questions)
    next_question = None if done else questions[next_idx]

    return {
        "success": True,
        "completed": done,
        "saved_answer": answer_record,
        "running_percentage": running_avg,
        "next_question_index": next_idx,
        "next_question": next_question,
        "total_questions": len(questions),
    }


@app.post("/vr-bridge/complete")
async def complete_vr_bridge_test(
    payload: VRBridgeCompleteRequest,
    bridge_token: str,
):
    db = get_db()
    session = _get_session_by_bridge_token(db, bridge_token)
    session_id_obj = session["_id"]

    vr_state = session.get("vr_test") or {}
    questions = vr_state.get("questions") or []
    answers = vr_state.get("answers") or []
    if not questions:
        raise HTTPException(status_code=404, detail="VR test not initialized for this session")

    total_score = sum(a.get("score", 0) for a in answers)
    max_score = len(questions) * 100
    percentage = (total_score / max_score * 100) if max_score > 0 else 0
    completed_at = datetime.now()
    difficulty_label = vr_state.get("difficulty") or session.get("difficulty") or "medium"
    derived_topic = vr_state.get("topic") or session.get("topic") or "General"

    db.user_sessions.update_one(
        {"_id": session_id_obj},
        {
            "$set": {
                "status": "completed",
                "mode": "vr",
                "completed_at": completed_at,
                "total_score": total_score,
                "max_score": max_score,
                "percentage": percentage,
                "evaluated_answers": answers,
                "topic": derived_topic,
                "difficulty": difficulty_label,
                "time_spent": payload.time_spent,
                "tab_switches": 0,
                "vr_test.status": "completed",
                "vr_test.completed_at": completed_at,
            },
            "$push": {
                "test_attempts": {
                    "completed_at": completed_at,
                    "percentage": percentage,
                    "topic": derived_topic,
                    "difficulty": difficulty_label,
                    "time_spent": payload.time_spent,
                    "tab_switches": 0,
                    "mode": "vr",
                }
            }
        }
    )

    return {
        "success": True,
        "mode": "vr",
        "answered": len(answers),
        "total_questions": len(questions),
        "total_score": total_score,
        "max_score": max_score,
        "percentage": round(percentage, 2),
        "evaluated_answers": answers,
    }

@app.post("/submit-test")
async def submit_test(
    submission: TestSubmission,
    current_user: Dict = Depends(get_current_user)
):
    """
    Submit completed test and calculate score
    """
    try:
        db = get_db()
        
        # Try to import ObjectId, fall back to mock
        try:
            from bson import ObjectId
            session_id_obj = ObjectId(submission.session_id)
        except:
            from backend.db.mock_mongo import MockObjectId
            session_id_obj = MockObjectId(submission.session_id)
        
        # Get session
        session = db.user_sessions.find_one({"_id": session_id_obj})
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        
        # Verify user owns session
        if session["user_id"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Not authorized")
        
        # Evaluate all answers
        total_score = 0
        evaluated_answers = []
        
        for qa in submission.answers:
            evaluation = simple_evaluate_answer(
                qa.question,
                qa.user_answer,
                qa.correct_answer or ""
            )
            
            evaluated_answers.append({
                "question": qa.question,
                "user_answer": qa.user_answer,
                "score": evaluation.get("score", 0),
                "feedback": evaluation.get("feedback", ""),
                "is_correct": evaluation.get("is_correct", False)
            })
            
            total_score += evaluation.get("score", 0)
        
        # Calculate percentage
        max_score = len(submission.answers) * 100
        percentage = (total_score / max_score * 100) if max_score > 0 else 0
        
        # Derive a topic if not provided
        derived_topic = submission.topic
        if not derived_topic:
            try:
                topic_counts: Dict[str, int] = {}
                for q in session.get("questions", []):
                    t = (q.get("topic") or "General").strip() or "General"
                    topic_counts[t] = topic_counts.get(t, 0) + 1
                derived_topic = (
                    max(topic_counts.items(), key=lambda item: item[1])[0]
                    if topic_counts
                    else "General"
                )
            except Exception:
                derived_topic = "General"

        # Update session in database
        completed_at = datetime.now()
        difficulty_label = submission.difficulty or session.get("difficulty") or "medium"
        submission_mode = (submission.mode or "normal").lower()

        db.user_sessions.update_one(
            {"_id": session_id_obj},
            {
                "$set": {
                    "status": "completed",
                    "mode": submission_mode,
                    "completed_at": completed_at,
                    "total_score": total_score,
                    "max_score": max_score,
                    "percentage": percentage,
                    "evaluated_answers": evaluated_answers,
                    "topic": derived_topic,
                    "difficulty": difficulty_label,
                    "time_spent": submission.time_spent,
                    "tab_switches": submission.tab_switches
                },
                "$push": {
                    "test_attempts": {
                        "completed_at": completed_at,
                        "percentage": percentage,
                        "topic": derived_topic,
                        "difficulty": difficulty_label,
                        "time_spent": submission.time_spent,
                        "tab_switches": submission.tab_switches,
                        "mode": submission_mode,
                    }
                }
            }
        )
        
        return {
            "session_id": submission.session_id,
            "total_score": total_score,
            "max_score": max_score,
            "percentage": round(percentage, 2),
            "evaluated_answers": evaluated_answers
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Test submission error: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to submit test: {str(e)}"
        )

@app.get("/user-session/{session_id}")
async def get_user_session(
    session_id: str,
    current_user: Dict = Depends(get_current_user)
):
    """
    Get user session details
    """
    try:
        db = get_db()
        
        # Try to import ObjectId, fall back to mock
        try:
            from bson import ObjectId
            make_object_id = ObjectId
        except:
            from backend.db.mock_mongo import MockObjectId
            make_object_id = MockObjectId
        
        session = db.user_sessions.find_one({"_id": make_object_id(session_id)})
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        
        # Verify user owns session
        if session["user_id"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Not authorized")
        
        # Convert ObjectId to string
        session["_id"] = str(session["_id"])
        
        return session
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching session: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch session: {str(e)}"
        )

@app.get("/performance")
async def get_performance(
    current_user: Dict = Depends(get_current_user)
):
    """
    Advanced performance analytics with:
      - Topic-wise breakdown & weak-area identification
      - Score trend with moving average & improvement rate
      - Difficulty-level breakdown
      - Streak tracking (consecutive >=70% tests)
      - Percentile ranking among all users
      - Time efficiency metrics
      - Personalized study recommendations
    """
    try:
        db = get_db()
        
        # â”€â”€ 1. Gather user's completed sessions â”€â”€
        sessions = list(db.user_sessions.find(
            {"user_id": current_user["id"]},
            {
                "_id": 1, "created_at": 1, "completed_at": 1,
                "total_score": 1, "max_score": 1, "percentage": 1,
                "skills": 1, "status": 1, "topic": 1,
                "difficulty": 1, "time_spent": 1, "test_attempts": 1,
                "evaluated_answers": 1, "tab_switches": 1,
            }
        ).sort("created_at", -1))
        
        for session in sessions:
            session["_id"] = str(session["_id"])
        
        # â”€â”€ 2. Flatten all attempts â”€â”€
        attempts: List[Dict[str, Any]] = []
        for s in sessions:
            if s.get("test_attempts"):
                for attempt in s.get("test_attempts", []):
                    attempts.append({
                        "submittedAt": attempt.get("completed_at"),
                        "topic": attempt.get("topic") or s.get("topic") or "General",
                        "difficulty": attempt.get("difficulty") or s.get("difficulty") or "medium",
                        "timeSpent": attempt.get("time_spent") or 0,
                        "score": round(attempt.get("percentage", 0), 2),
                        "status": "completed",
                        "tabSwitches": attempt.get("tab_switches") or 0,
                        "mode": attempt.get("mode") or s.get("mode") or "normal",
                    })
            elif s.get("status") == "completed" or (s.get("max_score") or 0) > 0:
                submitted_at = s.get("completed_at") or s.get("created_at")
                attempts.append({
                    "submittedAt": submitted_at,
                    "topic": s.get("topic") or "General",
                    "difficulty": s.get("difficulty") or "medium",
                    "timeSpent": s.get("time_spent") or 0,
                    "score": round(s.get("percentage", 0), 2),
                    "status": s.get("status") or "completed",
                    "tabSwitches": s.get("tab_switches") or 0,
                    "mode": s.get("mode") or "normal",
                })
        
        total_tests = len(attempts)
        scores = [a["score"] for a in attempts]
        avg_score = sum(scores) / total_tests if total_tests else 0
        accuracy_rate = (
            sum(1 for s in scores if s >= 70) / total_tests * 100
        ) if total_tests else 0
        
        # â”€â”€ 3. Build results list â”€â”€
        results = []
        for a in attempts:
            submitted_at = a.get("submittedAt")
            results.append({
                "submittedAt": submitted_at.isoformat() if submitted_at else None,
                "topic": a.get("topic") or "General",
                "difficulty": a.get("difficulty") or "medium",
                "timeSpent": a.get("timeSpent") or 0,
                "score": a.get("score") or 0,
                "status": a.get("status") or "completed",
                "tabSwitches": a.get("tabSwitches") or 0,
                "mode": a.get("mode") or "normal",
            })
        
        # â”€â”€ 4. Topic-wise breakdown â”€â”€
        topic_map: Dict[str, List[float]] = defaultdict(list)
        for a in attempts:
            topic_map[a["topic"]].append(a["score"])
        
        topic_breakdown: List[Dict[str, Any]] = []
        for topic, topic_scores in topic_map.items():
            t_avg = sum(topic_scores) / len(topic_scores)
            t_best = max(topic_scores)
            t_worst = min(topic_scores)
            # Improvement: last score minus first score
            improvement = topic_scores[0] - topic_scores[-1] if len(topic_scores) > 1 else 0
            topic_breakdown.append({
                "topic": topic,
                "attempts": len(topic_scores),
                "averageScore": round(t_avg, 2),
                "bestScore": round(t_best, 2),
                "worstScore": round(t_worst, 2),
                "improvement": round(improvement, 2),
                "status": "strong" if t_avg >= 75 else "moderate" if t_avg >= 55 else "weak",
            })
        
        # Sort: weakest first for study priority
        topic_breakdown.sort(key=lambda x: x["averageScore"])
        
        # â”€â”€ 5. Difficulty-level breakdown â”€â”€
        diff_map: Dict[str, List[float]] = defaultdict(list)
        for a in attempts:
            diff_map[a["difficulty"].lower()].append(a["score"])
        
        difficulty_breakdown: Dict[str, Any] = {}
        for diff, diff_scores in diff_map.items():
            difficulty_breakdown[diff] = {
                "attempts": len(diff_scores),
                "averageScore": round(sum(diff_scores) / len(diff_scores), 2),
                "bestScore": round(max(diff_scores), 2),
            }
        
        # â”€â”€ 6. Score trend with Exponential Moving Average (EMA) â”€â”€
        sorted_attempts = sorted(
            [a for a in attempts if a.get("submittedAt")],
            key=lambda a: a["submittedAt"]
        )
        
        score_trend: List[Dict[str, Any]] = []
        alpha = 0.3  # EMA smoothing factor
        ema = sorted_attempts[0]["score"] if sorted_attempts else 0
        
        for i, a in enumerate(sorted_attempts):
            ema = alpha * a["score"] + (1 - alpha) * ema
            score_trend.append({
                "index": i + 1,
                "date": a["submittedAt"].isoformat() if a.get("submittedAt") else None,
                "score": a["score"],
                "ema": round(ema, 2),
                "topic": a["topic"],
                "difficulty": a["difficulty"],
            })
        
        # Improvement rate: linear regression slope of recent scores
        improvement_rate = 0.0
        if len(scores) >= 3:
            recent_n = min(10, len(sorted_attempts))
            recent_scores = [a["score"] for a in sorted_attempts[-recent_n:]]
            n = len(recent_scores)
            x_mean = (n - 1) / 2
            y_mean = sum(recent_scores) / n
            numerator = sum((i - x_mean) * (s - y_mean) for i, s in enumerate(recent_scores))
            denominator = sum((i - x_mean) ** 2 for i in range(n))
            improvement_rate = round(numerator / denominator, 2) if denominator else 0
        
        # â”€â”€ 7. Streak tracking â”€â”€
        current_streak = 0
        best_streak = 0
        temp_streak = 0
        for a in sorted_attempts:
            if a["score"] >= 70:
                temp_streak += 1
                best_streak = max(best_streak, temp_streak)
            else:
                temp_streak = 0
        # Current streak counts backward from last attempt
        for a in reversed(sorted_attempts):
            if a["score"] >= 70:
                current_streak += 1
            else:
                break
        
        # â”€â”€ 8. Percentile ranking among all users â”€â”€
        percentile_rank = 50.0  # default
        try:
            all_user_sessions = list(db.user_sessions.find(
                {"status": "completed", "percentage": {"$exists": True}},
                {"user_id": 1, "percentage": 1}
            ))
            user_avgs: Dict[str, List[float]] = defaultdict(list)
            for s in all_user_sessions:
                uid = s.get("user_id", "")
                pct = s.get("percentage", 0)
                if pct > 0:
                    user_avgs[uid].append(pct)
            
            if len(user_avgs) > 1:
                avg_per_user = {uid: sum(sc) / len(sc) for uid, sc in user_avgs.items()}
                my_avg = avg_per_user.get(current_user["id"], avg_score)
                below_count = sum(1 for v in avg_per_user.values() if v < my_avg)
                percentile_rank = round((below_count / len(avg_per_user)) * 100, 1)
        except Exception:
            pass
        
        # â”€â”€ 9. Time efficiency metrics â”€â”€
        time_efficiency = None
        timed_attempts = [a for a in attempts if (a.get("timeSpent") or 0) > 0]
        if timed_attempts:
            avg_time = sum(a["timeSpent"] for a in timed_attempts) / len(timed_attempts)
            # Score per minute (higher is better)
            avg_score_per_min = sum(
                a["score"] / max(1, a["timeSpent"] / 60)
                for a in timed_attempts
            ) / len(timed_attempts)
            time_efficiency = {
                "averageTimeSeconds": round(avg_time, 0),
                "averageTimeMinutes": round(avg_time / 60, 1),
                "scorePerMinute": round(avg_score_per_min, 2),
                "fastestTest": round(min(a["timeSpent"] for a in timed_attempts) / 60, 1),
                "slowestTest": round(max(a["timeSpent"] for a in timed_attempts) / 60, 1),
            }
        
        # â”€â”€ 10. Weak areas & study recommendations â”€â”€
        weak_topics = [t for t in topic_breakdown if t["status"] == "weak"]
        moderate_topics = [t for t in topic_breakdown if t["status"] == "moderate"]
        
        study_recommendations: List[Dict[str, str]] = []
        for wt in weak_topics[:3]:
            study_recommendations.append({
                "topic": wt["topic"],
                "priority": "high",
                "reason": f"Average score {wt['averageScore']}% across {wt['attempts']} attempts",
                "action": f"Focus on fundamentals of {wt['topic']}. Review core concepts and practice more.",
            })
        for mt in moderate_topics[:2]:
            study_recommendations.append({
                "topic": mt["topic"],
                "priority": "medium",
                "reason": f"Average score {mt['averageScore']}% â€” close to proficiency",
                "action": f"Practice harder questions in {mt['topic']} to solidify your understanding.",
            })
        
        # Suggest moving to harder difficulty if consistently scoring high
        if avg_score >= 80 and total_tests >= 3:
            dominant_diff = max(diff_map.items(), key=lambda x: len(x[1]))[0] if diff_map else "medium"
            if dominant_diff != "hard":
                next_diff = "medium" if dominant_diff == "easy" else "hard"
                study_recommendations.append({
                    "topic": "General",
                    "priority": "growth",
                    "reason": f"Average of {round(avg_score, 1)}% on {dominant_diff} â€” ready for more challenge",
                    "action": f"Try switching to {next_diff} difficulty to continue improving.",
                })
        
        # â”€â”€ 11. Build stats â”€â”€
        stats = {
            "totalTests": total_tests,
            "averageScore": round(avg_score, 2),
            "accuracyRate": round(accuracy_rate, 2),
            "bestScore": round(max(scores), 2) if scores else 0,
            "worstScore": round(min(scores), 2) if scores else 0,
            "medianScore": round(sorted(scores)[len(scores) // 2], 2) if scores else 0,
            "currentStreak": current_streak,
            "bestStreak": best_streak,
            "improvementRate": improvement_rate,
            "percentileRank": percentile_rank,
        }
        
        return {
            "success": True,
            "results": results,
            "stats": stats,
            "total_tests": total_tests,
            "average_score": round(avg_score, 2),
            "sessions": sessions,
            "topicBreakdown": topic_breakdown,
            "difficultyBreakdown": difficulty_breakdown,
            "scoreTrend": score_trend,
            "timeEfficiency": time_efficiency,
            "studyRecommendations": study_recommendations,
        }
        
    except Exception as e:
        logger.error(f"Performance error: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch performance: {str(e)}"
        )

# ========== COMMUNICATION TEST ENDPOINTS ==========

@app.post("/admin/seed-comm-pool")
async def seed_comm_pool(
    count: int = 3,
    difficulty: Optional[str] = None,
    admin_key: Optional[str] = None,
):
    """
    Admin endpoint to pre-generate communication tests and store in the pool.
    Requires ADMIN_KEY query param matching the env var (or OPENAI_API_KEY prefix).
    Usage: POST /admin/seed-comm-pool?count=5&difficulty=medium&admin_key=YOUR_KEY
    """
    expected_key = os.getenv("ADMIN_KEY") or (os.getenv("OPENAI_API_KEY") or "")[:20]
    if not admin_key or admin_key != expected_key:
        raise HTTPException(status_code=403, detail="Invalid admin key")

    db = get_db()
    difficulties = [difficulty] if difficulty else ["easy", "medium", "hard"]
    results = {"generated": 0, "failed": 0, "details": []}

    comm_test_prompt = """You are an expert corporate communication assessment designer used by top companies like TCS, Infosys, Wipro, Cognizant, and Accenture for hiring.

Generate a complete Communication Skills Test at {difficulty} difficulty level.

The test MUST contain exactly 15 questions divided into these 5 sections (3 questions each):

**Section 1: Reading Comprehension** - Provide a short professional passage (80-120 words). Ask 3 MCQ questions with 4 options each.
**Section 2: Email / Business Writing** - Give a workplace scenario. 2 MCQ + 1 open-ended writing question.
**Section 3: Grammar & Vocabulary** - 3 MCQ questions (sentence correction, fill-in-blank, error identification).
**Section 4: Situational Communication** - 3 workplace scenario MCQs with professional response options.
**Section 5: Spoken English Prompt** - 3 open-ended speaking/typing prompts.

Return ONLY valid JSON with "passage" and "sections" keys. Each question has: id, question, options (for MCQ), correct_answer, explanation, type (mcq/open)."""

    for diff in difficulties:
        for i in range(count):
            try:
                raw, provider = await call_ai_with_fallback(
                    messages=[
                        {"role": "system", "content": "You are an assessment designer. Return only valid JSON."},
                        {"role": "user", "content": comm_test_prompt.format(difficulty=diff.capitalize())},
                    ],
                    temperature=0.9,
                    max_tokens=4000,
                )
                parsed = parse_json_response(raw)

                if parsed and "sections" in parsed:
                    db.comm_test_pool.insert_one({
                        "difficulty": diff,
                        "test_data": parsed,
                        "created_at": datetime.now(),
                        "times_served": 0,
                    })
                    results["generated"] += 1
                    results["details"].append(f"{diff} #{i+1}: OK")
                else:
                    results["failed"] += 1
                    results["details"].append(f"{diff} #{i+1}: parse failed")
            except Exception as e:
                results["failed"] += 1
                results["details"].append(f"{diff} #{i+1}: {str(e)[:100]}")

    # Pool status
    pool_status = {}
    for d in ["easy", "medium", "hard"]:
        pool_status[d] = db.comm_test_pool.count_documents({"difficulty": d})

    return {"success": True, "results": results, "pool_status": pool_status}


@app.get("/admin/comm-pool-status")
async def comm_pool_status():
    """Public endpoint to check the communication test pool size."""
    db = get_db()
    status = {}
    for d in ["easy", "medium", "hard"]:
        status[d] = db.comm_test_pool.count_documents({"difficulty": d})
    return {"pool": status, "total": sum(status.values())}


def _local_comm_test_template() -> Dict[str, Any]:
    return {
        "passage": "This is a fallback reading passage used when AI services are unavailable.",
        "sections": [
            {"name": "Reading Comprehension", "type": "mcq", "questions": [
                {"id": "rc-1", "question": "What is the main topic of the passage?", "options": ["A) Topic A", "B) Topic B", "C) Topic C", "D) Topic D"], "correct_answer": "A"},
                {"id": "rc-2", "question": "Which statement is true?", "options": ["A) True", "B) False", "C) Maybe", "D) Not stated"], "correct_answer": "A"},
                {"id": "rc-3", "question": "The tone of the passage is:", "options": ["A) Formal", "B) Casual", "C) Humorous", "D) Technical"], "correct_answer": "A"},
            ]},
            {"name": "Email Writing", "type": "mixed", "scenario": "Write an email to request leave.", "questions": [
                {"id": "ew-1", "question": "Choose the best subject line", "options": ["A) Leave Request", "B) Hello", "C) FYI", "D) No Subject"], "correct_answer": "A", "type": "mcq"},
                {"id": "ew-2", "question": "Choose the best opening sentence", "options": ["A) I need leave", "B) Dear Manager", "C) Hi", "D) Yo"], "correct_answer": "B", "type": "mcq"},
                {"id": "ew-3", "question": "Write a brief closing line for the email", "type": "open", "correct_answer": "Kind regards,"},
            ]},
            {"name": "Grammar & Vocabulary", "type": "mcq", "questions": [
                {"id": "gv-1", "question": "Choose the correct sentence.", "options": ["A) She go to work.", "B) She goes to work.", "C) She going.", "D) She gone."], "correct_answer": "B"},
                {"id": "gv-2", "question": "Choose the best word: He ___ the report.", "options": ["A) submit", "B) submitted", "C) submitting", "D) submits"], "correct_answer": "B"},
                {"id": "gv-3", "question": "Identify the error: 'Their going to the meeting.'", "options": ["A) Their", "B) going", "C) meeting", "D) No error"], "correct_answer": "A"},
            ]},
            {"name": "Situational Communication", "type": "mcq", "questions": [
                {"id": "sc-1", "question": "How would you respond to an upset client?", "options": ["A) Ignore", "B) Apologize and investigate", "C) Blame team", "D) Escalate immediately"], "correct_answer": "B"},
                {"id": "sc-2", "question": "Best approach to give feedback?", "options": ["A) Public criticism", "B) Private and constructive", "C) Sarcasm", "D) None"], "correct_answer": "B"},
                {"id": "sc-3", "question": "When to follow-up?", "options": ["A) Immediately", "B) After a reasonable time", "C) Never", "D) Randomly"], "correct_answer": "B"},
            ]},
            {"name": "Spoken English", "type": "open", "questions": [
                {"id": "se-1", "question": "Introduce yourself for a job interview in 60 seconds.", "type": "open", "correct_answer": "A concise introduction covering background and goals."},
                {"id": "se-2", "question": "Explain a technical concept to a non-technical person.", "type": "open", "correct_answer": "Use analogy and simple language."},
                {"id": "se-3", "question": "Describe how you handled a conflict at work.", "type": "open", "correct_answer": "Describe situation, action, and result."},
            ]},
        ],
    }


def _merge_comm_test_candidates(candidates: List[Dict[str, Any]]) -> Dict[str, Any]:
    template = _local_comm_test_template()
    if not candidates:
        return template

    section_order = [
        ("Reading Comprehension", "mcq"),
        ("Email Writing", "mixed"),
        ("Grammar & Vocabulary", "mcq"),
        ("Situational Communication", "mcq"),
        ("Spoken English", "open"),
    ]
    key_map = {
        "reading comprehension": "reading comprehension",
        "email writing": "email writing",
        "grammar & vocabulary": "grammar & vocabulary",
        "situational communication": "situational communication",
        "spoken english": "spoken english",
    }

    pooled: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    passage = ""
    email_scenario = ""

    for parsed in candidates:
        if not passage:
            passage = (parsed.get("passage") or "").strip()
        for sec in parsed.get("sections", []):
            if not isinstance(sec, dict):
                continue
            sec_name = (sec.get("name") or "").strip().lower()
            canonical = key_map.get(sec_name)
            if not canonical:
                continue
            if canonical == "email writing" and not email_scenario:
                email_scenario = (sec.get("scenario") or "").strip()
            for q in sec.get("questions", []):
                if isinstance(q, dict) and (q.get("question") or "").strip():
                    pooled[canonical].append(q)

    merged_sections: List[Dict[str, Any]] = []
    template_sections = {((s.get("name") or "").strip().lower()): s for s in template.get("sections", [])}

    for section_name, section_type in section_order:
        canonical = section_name.lower()
        seen = set()
        picked: List[Dict[str, Any]] = []

        for q in pooled.get(canonical, []):
            q_key = ((q.get("id") or "") + "|" + (q.get("question") or "")).strip().lower()
            if not q_key or q_key in seen:
                continue
            seen.add(q_key)
            picked.append(q)
            if len(picked) >= 3:
                break

        if len(picked) < 3:
            fallback_sec = template_sections.get(canonical, {})
            for q in fallback_sec.get("questions", []):
                q_key = ((q.get("id") or "") + "|" + (q.get("question") or "")).strip().lower()
                if not q_key or q_key in seen:
                    continue
                seen.add(q_key)
                picked.append(q)
                if len(picked) >= 3:
                    break

        section_payload: Dict[str, Any] = {
            "name": section_name,
            "type": section_type,
            "questions": picked[:3],
        }
        if section_name == "Email Writing":
            section_payload["scenario"] = email_scenario or template_sections.get(canonical, {}).get("scenario", "")
        merged_sections.append(section_payload)

    return {
        "passage": passage or template.get("passage", ""),
        "sections": merged_sections,
    }


@app.post("/generate-comm-test")
async def generate_comm_test(
    payload: CommTestRequest,
    current_user: Dict = Depends(get_current_user)
):
    """
    Generate a corporate-style communication test.
    First tries to serve a pre-generated test from the cache pool (zero GPT cost).
    Falls back to live GPT generation only if the pool is empty.
    """
    try:
        raw_text = ""
        provider = "unknown"
        db = get_db()
        difficulty = (payload.difficulty or "medium").strip().lower()

        # --- Try cached pool first ---
        cached_test = db.comm_test_pool.find_one(
            {"difficulty": difficulty},
            sort=[("times_served", 1)],  # least-served first for variety
        )

        if cached_test and "test_data" in cached_test:
            parsed = cached_test["test_data"]
            logger.info(f"Serving cached comm test (id={cached_test.get('_id')}, difficulty={difficulty})")

            # Increment times_served so we rotate through the pool
            db.comm_test_pool.update_one(
                {"_id": cached_test["_id"]},
                {"$set": {"times_served": cached_test.get("times_served", 0) + 1}}
            )

            # Store session for this user
            comm_session = {
                "user_id": current_user["id"],
                "type": "communication_test",
                "difficulty": difficulty,
                "test_data": parsed,
                "created_at": datetime.now(),
                "status": "in_progress",
                "source": "cached",
            }
            result = db.user_sessions.insert_one(comm_session)
            session_id = str(result.inserted_id)

            return {
                "success": True,
                "session_id": session_id,
                "difficulty": difficulty,
                "passage": parsed.get("passage", ""),
                "sections": parsed["sections"],
                "total_questions": sum(len(s.get("questions", [])) for s in parsed["sections"]),
            }

        # --- Fallback: generate live via AI (multi-provider fallback) ---
        logger.info(f"No cached tests for difficulty={difficulty}, falling back to live AI")
        difficulty = (payload.difficulty or "medium").capitalize()

        prompt = f"""You are an expert corporate communication assessment designer used by top companies like TCS, Infosys, Wipro, Cognizant, and Accenture for hiring.

Generate a complete Communication Skills Test at {difficulty} difficulty level.

The test MUST contain exactly 15 questions divided into these 5 sections (3 questions each):

**Section 1: Reading Comprehension**
- Provide a short professional passage (80-120 words) about a workplace/business scenario.
- Ask 3 MCQ questions based on the passage.
- Each question has 4 options (A, B, C, D) with one correct answer.

**Section 2: Email / Business Writing**
- Give a workplace scenario (e.g., "Write an email to your manager requesting leave").
- Ask 3 questions: one asking to choose the best subject line (MCQ), one choosing the correct email body (MCQ), one asking the user to write a professional email response (open-ended, 3-5 sentences).

**Section 3: Grammar & Vocabulary**
- 3 MCQ questions testing: sentence correction, fill-in-the-blank with correct word, identify the error.
- Each with 4 options.

**Section 4: Situational Communication**
- Present 3 workplace scenarios (e.g., "A client is upset about a delayed delivery. How do you respond?")
- For each: provide 4 response options (MCQ), one is the most professional.

**Section 5: Spoken English Prompt**
- 3 open-ended questions where the candidate must speak/type a response.
- E.g., "Introduce yourself for a job interview in 60 seconds", "Explain a technical concept to a non-technical person", "Describe how you handled a conflict at work".

Return ONLY valid JSON (no markdown, no explanation) in this exact format:
{{
  "passage": "The reading comprehension passage text here...",
  "sections": [
    {{
      "name": "Reading Comprehension",
      "type": "mcq",
      "questions": [
        {{
          "id": "rc-1",
          "question": "Question text",
          "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
          "correct_answer": "B",
          "explanation": "Why B is correct"
        }}
      ]
    }},
    {{
      "name": "Email Writing",
      "type": "mixed",
      "scenario": "The email scenario...",
      "questions": [
        {{
          "id": "ew-1",
          "question": "Choose the best subject line",
          "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
          "correct_answer": "C",
          "explanation": "...",
          "type": "mcq"
        }},
        {{
          "id": "ew-3",
          "question": "Write a professional email response for this scenario",
          "correct_answer": "A sample ideal email response",
          "explanation": "Key elements to include",
          "type": "open"
        }}
      ]
    }},
    {{
      "name": "Grammar & Vocabulary",
      "type": "mcq",
      "questions": [
        {{
          "id": "gv-1",
          "question": "...",
          "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
          "correct_answer": "A",
          "explanation": "..."
        }}
      ]
    }},
    {{
      "name": "Situational Communication",
      "type": "mcq",
      "questions": [
        {{
          "id": "sc-1",
          "question": "Scenario: ... How do you respond?",
          "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
          "correct_answer": "D",
          "explanation": "..."
        }}
      ]
    }},
    {{
      "name": "Spoken English",
      "type": "open",
      "questions": [
        {{
          "id": "se-1",
          "question": "Introduce yourself for a job interview in 60 seconds.",
          "correct_answer": "A model answer covering name, background, skills, and goals",
          "explanation": "Should be structured, confident, and professional",
          "type": "open"
        }}
      ]
    }}
  ]
}}"""

        parallel = await call_ai_parallel(
            messages=[
                {"role": "system", "content": "You are an assessment designer. Return only valid JSON."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_tokens=4000,
            providers=["gemini", "claude", "openai", "deepseek"],
        )

        parsed_candidates: List[Dict[str, Any]] = []
        successful_providers: List[str] = []
        for s in parallel.get("successes", []):
            provider_name = s.get("provider", "unknown")
            parsed_item = parse_json_response(s.get("raw_text", ""))
            if parsed_item and isinstance(parsed_item, dict) and "sections" in parsed_item:
                parsed_candidates.append(parsed_item)
                successful_providers.append(provider_name)

        if not parsed_candidates:
            logger.warning("All AI providers failed/invalid for comm test; using local fallback template")
            provider = "fallback-local"
            parsed = _local_comm_test_template()
        else:
            parsed = _merge_comm_test_candidates(parsed_candidates)
            provider = f"parallel:{','.join(successful_providers)}"

        if not parsed or "sections" not in parsed:
            logger.error("Communication test generation produced invalid payload after merge/fallback")
            raise HTTPException(status_code=500, detail="Failed to generate communication test")

        # Store in DB for later scoring
        comm_session = {
            "user_id": current_user["id"],
            "type": "communication_test",
            "difficulty": difficulty,
            "test_data": parsed,
            "created_at": datetime.now(),
            "status": "in_progress",
            "source": provider,
        }
        result = db.user_sessions.insert_one(comm_session)
        session_id = str(result.inserted_id)

        return {
            "success": True,
            "session_id": session_id,
            "difficulty": difficulty.lower(),
            "passage": parsed.get("passage", ""),
            "sections": parsed["sections"],
            "total_questions": sum(len(s.get("questions", [])) for s in parsed["sections"]),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Comm test generation error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate communication test: {str(e)}")


@app.post("/submit-comm-test")
async def submit_comm_test(
    session_id: str,
    submission: CommTestSubmission,
    current_user: Dict = Depends(get_current_user)
):
    """
    Score a communication test. MCQs auto-scored, open-ended scored by GPT.
    """
    try:
        db = get_db()
        try:
            from bson import ObjectId
            session_id_obj = ObjectId(session_id)
        except Exception:
            from backend.db.mock_mongo import MockObjectId
            session_id_obj = MockObjectId(session_id)

        session = db.user_sessions.find_one({"_id": session_id_obj})
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        if session["user_id"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Not authorized")

        total_score = 0
        total_questions = 0
        evaluated = []
        open_ended_to_grade = []

        for ans in submission.answers:
            total_questions += 1
            q_type = ans.get("type", "mcq")
            if q_type == "mcq":
                # Auto-grade MCQ
                user_choice = (ans.get("user_answer") or "").strip().upper()[:1]
                correct = (ans.get("correct_answer") or "").strip().upper()[:1]
                is_correct = user_choice == correct
                score = 100 if is_correct else 0
                total_score += score
                evaluated.append({
                    "question_id": ans.get("question_id"),
                    "section": ans.get("section"),
                    "question": ans.get("question"),
                    "user_answer": ans.get("user_answer"),
                    "correct_answer": ans.get("correct_answer"),
                    "score": score,
                    "is_correct": is_correct,
                    "type": "mcq",
                })
            else:
                open_ended_to_grade.append(ans)

        # Grade open-ended with AI (multi-provider fallback)
        if open_ended_to_grade:
            for ans in open_ended_to_grade:
                grading_prompt = f"""Grade this communication test answer on a scale of 0-100.

Question: {ans.get('question')}
Ideal Answer: {ans.get('correct_answer')}
Student Answer: {ans.get('user_answer')}

Evaluate on: clarity, professionalism, grammar, relevance, and completeness.
Return ONLY JSON: {{"score": <0-100>, "feedback": "brief feedback"}}"""
                try:
                    grade_text, _provider = await call_ai_with_fallback(
                        messages=[{"role": "user", "content": grading_prompt}],
                        temperature=0.3,
                        max_tokens=200,
                    )
                    grade_data = parse_json_response(grade_text)
                    if not grade_data:
                        grade_data = {"score": 50, "feedback": "Could not parse grade"}

                    score = min(100, max(0, int(grade_data.get("score", 50))))
                    total_score += score
                    evaluated.append({
                        "question_id": ans.get("question_id"),
                        "section": ans.get("section"),
                        "question": ans.get("question"),
                        "user_answer": ans.get("user_answer"),
                        "correct_answer": ans.get("correct_answer"),
                        "score": score,
                        "feedback": grade_data.get("feedback", ""),
                        "type": "open",
                    })
                except Exception as ge:
                    logger.warning(f"AI grading error: {ge}")
                    total_score += 50
                    evaluated.append({
                        "question_id": ans.get("question_id"),
                        "section": ans.get("section"),
                        "question": ans.get("question"),
                        "user_answer": ans.get("user_answer"),
                        "score": 50,
                        "feedback": "Auto-graded (AI unavailable)",
                        "type": "open",
                    })

        max_score = total_questions * 100
        percentage = round((total_score / max_score * 100), 2) if max_score > 0 else 0

        # Section-wise breakdown
        section_scores = {}
        for ev in evaluated:
            sec = ev.get("section", "Unknown")
            if sec not in section_scores:
                section_scores[sec] = {"total": 0, "count": 0}
            section_scores[sec]["total"] += ev["score"]
            section_scores[sec]["count"] += 1
        for sec in section_scores:
            section_scores[sec]["percentage"] = round(
                section_scores[sec]["total"] / (section_scores[sec]["count"] * 100) * 100, 1
            )

        # Update DB
        db.user_sessions.update_one(
            {"_id": session_id_obj},
            {"$set": {
                "status": "completed",
                "completed_at": datetime.now(),
                "total_score": total_score,
                "max_score": max_score,
                "percentage": percentage,
                "evaluated_answers": evaluated,
                "section_scores": section_scores,
                "time_spent": submission.time_spent,
                "topic": "Communication Skills",
            }}
        )

        return {
            "success": True,
            "percentage": percentage,
            "total_score": total_score,
            "max_score": max_score,
            "section_scores": section_scores,
            "evaluated_answers": evaluated,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Comm test submit error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to submit comm test: {str(e)}")


@app.get("/communication-feedback")
async def communication_feedback(
    current_user: Dict = Depends(get_current_user)
):
    """
    Generate a GPT-powered communication feedback report based on all
    completed communication tests. Analyzes section-wise performance and
    provides personalised improvement advice.
    """
    try:
        db = get_db()

        # Fetch all completed communication test sessions for this user
        comm_sessions = list(db.user_sessions.find(
            {
                "user_id": current_user["id"],
                "type": "communication_test",
                "status": "completed",
            },
            {
                "_id": 0,
                "difficulty": 1,
                "percentage": 1,
                "section_scores": 1,
                "evaluated_answers": 1,
                "completed_at": 1,
                "time_spent": 1,
            }
        ).sort("completed_at", -1).limit(10))  # last 10 tests

        if not comm_sessions:
            return {
                "success": True,
                "has_data": False,
                "message": "No completed communication tests found. Take a communication test first to get your feedback report.",
            }

        # Build a summary for GPT
        test_summaries = []
        all_section_scores = {}
        all_open_answers = []

        for idx, sess in enumerate(comm_sessions):
            diff = sess.get("difficulty", "medium")
            pct = sess.get("percentage", 0)
            ts = sess.get("time_spent", 0)
            test_summaries.append(f"Test {idx+1}: difficulty={diff}, score={pct}%, time={round(ts/60, 1)}min")

            for sec, data in (sess.get("section_scores") or {}).items():
                if sec not in all_section_scores:
                    all_section_scores[sec] = []
                all_section_scores[sec].append(data.get("percentage", 0))

            for ev in (sess.get("evaluated_answers") or []):
                if ev.get("type") == "open":
                    all_open_answers.append({
                        "section": ev.get("section", ""),
                        "question": ev.get("question", ""),
                        "answer": (ev.get("user_answer") or "")[:500],
                        "score": ev.get("score", 0),
                        "feedback": ev.get("feedback", ""),
                    })

        section_avg = {}
        for sec, scores in all_section_scores.items():
            section_avg[sec] = round(sum(scores) / len(scores), 1)

        overall_avg = round(
            sum(s.get("percentage", 0) for s in comm_sessions) / len(comm_sessions), 1
        )

        # Build AI prompt
        open_answers_text = ""
        for oa in all_open_answers[:12]:
            open_answers_text += f"\n- Section: {oa['section']}, Q: {oa['question'][:100]}, Answer: {oa['answer'][:200]}, Score: {oa['score']}/100, Feedback: {oa['feedback']}"

        prompt = f"""You are an expert corporate communication coach. Analyze this candidate's communication test performance and provide a detailed, actionable feedback report.

PERFORMANCE DATA:
- Tests taken: {len(comm_sessions)}
- Overall average: {overall_avg}%
- Section averages: {json_mod.dumps(section_avg)}
- Test history: {'; '.join(test_summaries)}

OPEN-ENDED ANSWERS (writing & speaking responses):
{open_answers_text if open_answers_text else "No open-ended answers available yet."}

Generate a comprehensive feedback report in ONLY valid JSON (no markdown, no explanation):
{{
  "overall_rating": "Excellent|Good|Average|Needs Improvement|Poor",
  "overall_summary": "2-3 sentence overall assessment of the candidate's communication skills",
  "strengths": [
    {{"area": "Strength area name", "detail": "Specific evidence-based explanation"}},
    {{"area": "...", "detail": "..."}}
  ],
  "weaknesses": [
    {{"area": "Weakness area name", "detail": "Specific evidence-based explanation"}},
    {{"area": "...", "detail": "..."}}
  ],
  "section_feedback": [
    {{
      "section": "Reading Comprehension",
      "score": <average score>,
      "rating": "Excellent|Good|Average|Needs Improvement",
      "feedback": "2-3 sentences of specific feedback",
      "tips": ["Actionable tip 1", "Actionable tip 2"]
    }},
    {{
      "section": "Email Writing",
      "score": <average score>,
      "rating": "...",
      "feedback": "...",
      "tips": ["...", "..."]
    }},
    {{
      "section": "Grammar & Vocabulary",
      "score": <average score>,
      "rating": "...",
      "feedback": "...",
      "tips": ["...", "..."]
    }},
    {{
      "section": "Situational Communication",
      "score": <average score>,
      "rating": "...",
      "feedback": "...",
      "tips": ["...", "..."]
    }},
    {{
      "section": "Spoken English",
      "score": <average score>,
      "rating": "...",
      "feedback": "...",
      "tips": ["...", "..."]
    }}
  ],
  "speaking_analysis": {{
    "fluency": "Brief assessment of writing/speaking fluency based on open-ended answers",
    "grammar_accuracy": "Assessment of grammatical correctness in responses",
    "vocabulary_range": "Assessment of vocabulary usage",
    "professionalism": "Assessment of professional tone and register",
    "confidence_indicators": "Assessment of confidence shown in responses"
  }},
  "improvement_plan": [
    {{"week": "Week 1-2", "focus": "Focus area", "activities": ["Activity 1", "Activity 2"]}},
    {{"week": "Week 3-4", "focus": "Focus area", "activities": ["Activity 1", "Activity 2"]}},
    {{"week": "Week 5-6", "focus": "Focus area", "activities": ["Activity 1", "Activity 2"]}}
  ],
  "recommended_resources": [
    {{"type": "Book|Video|Practice|Course", "title": "Resource name", "why": "Why this helps"}}
  ]
}}"""

        raw_text, provider = await call_ai_with_fallback(
            messages=[
                {"role": "system", "content": "You are a corporate communication coach. Return only valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.6,
            max_tokens=3000,
        )

        parsed = parse_json_response(raw_text)

        if not parsed:
            logger.error(f"AI feedback parse fail ({provider}): {raw_text[:500]}")
            raise HTTPException(status_code=500, detail="Failed to generate feedback report")

        return {
            "success": True,
            "has_data": True,
            "tests_analyzed": len(comm_sessions),
            "overall_average": overall_avg,
            "section_averages": section_avg,
            "report": parsed,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Communication feedback error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate feedback: {str(e)}")


@app.get("/recommend-jobs")
async def recommend_jobs(
    current_user: Dict = Depends(get_current_user)
):
    """
    Advanced job recommendation engine:
      - Performance-weighted skill scoring (strong skills ranked higher)
      - Skill gap analysis with growth trajectory
      - Multi-platform apply URLs (LinkedIn, Naukri, Indeed)
      - Experience-level inference from resume
      - Smarter proximity + match hybrid sorting
    """
    try:
        db = get_db()

        # Get user's latest session
        latest_session = db.user_sessions.find_one(
            {"user_id": current_user["id"]},
            sort=[("created_at", -1)]
        )

        if not latest_session:
            return {
                "success": False,
                "jobs": [],
                "user_skills": [],
                "university": None,
                "message": "No resume uploaded yet"
            }

        user_skills = list(set(latest_session.get("all_skills") or latest_session.get("skills") or []))
        resume_path = latest_session.get("resume_path", "")

        # â”€â”€ Performance-weighted skill analysis â”€â”€
        # Gather performance data per topic to identify strong vs weak skills
        skill_performance: Dict[str, Dict[str, Any]] = {}
        all_sessions = list(db.user_sessions.find(
            {"user_id": current_user["id"], "status": "completed"},
            {"topic": 1, "percentage": 1, "difficulty": 1, "test_attempts": 1}
        ))
        
        for s in all_sessions:
            topic = (s.get("topic") or "").strip()
            pct = s.get("percentage", 0)
            if topic and pct > 0:
                if topic not in skill_performance:
                    skill_performance[topic] = {"scores": [], "difficulty": []}
                skill_performance[topic]["scores"].append(pct)
                skill_performance[topic]["difficulty"].append(s.get("difficulty", "medium"))
            for att in s.get("test_attempts", []):
                t = (att.get("topic") or "").strip()
                p = att.get("percentage", 0)
                if t and p > 0:
                    if t not in skill_performance:
                        skill_performance[t] = {"scores": [], "difficulty": []}
                    skill_performance[t]["scores"].append(p)
                    skill_performance[t]["difficulty"].append(att.get("difficulty", "medium"))
        
        # Classify skills as strong/moderate/weak
        strong_skills: List[str] = []
        moderate_skills: List[str] = []
        weak_skills: List[str] = []
        
        for topic, data in skill_performance.items():
            avg = sum(data["scores"]) / len(data["scores"]) if data["scores"] else 0
            if avg >= 75:
                strong_skills.append(topic)
            elif avg >= 55:
                moderate_skills.append(topic)
            else:
                weak_skills.append(topic)
        
        # Skills without performance data are treated as claimed (unverified)
        tested_topics = set(skill_performance.keys())
        unverified_skills = [s for s in user_skills if _normalize_skill(s) not in {_normalize_skill(t) for t in tested_topics}]

        # --- Extract resume text to find university ---
        resume_text = ""
        if resume_path and os.path.exists(resume_path):
            try:
                from langchain_community.document_loaders import PyPDFLoader
                loader = PyPDFLoader(resume_path)
                docs = loader.load()
                resume_text = "\n".join([d.page_content for d in docs])
            except Exception as pdf_err:
                logger.warning(f"Could not read resume PDF for university extraction: {pdf_err}")

        # --- Build enhanced prompt ---
        skills_str = ", ".join(user_skills[:20])
        strong_str = ", ".join(strong_skills[:10]) if strong_skills else "Not yet assessed"
        weak_str = ", ".join(weak_skills[:5]) if weak_skills else "None identified"
        resume_snippet = resume_text[:2500] if resume_text else "(resume text unavailable)"

        prompt = f"""You are an expert Indian tech job market analyst with real-time knowledge of current job openings in India as of today.

CANDIDATE PROFILE:
- All Skills: {skills_str}
- Strong Skills (high test scores): {strong_str}
- Skills Needing Improvement: {weak_str}
- Resume excerpt (for university/education/experience detection):
\"\"\"
{resume_snippet}
\"\"\"

TASK:
1. Identify the university/college and years of experience from the resume. Output in "university", "university_city", and "experience_level" fields.
2. Generate exactly 10 realistic, currently-active job openings in India matching this candidate. Prioritize jobs that leverage their STRONG skills.
3. ALL jobs must be in India (Indian cities only).
4. Sort by a HYBRID score: proximity to university city PLUS skill match strength. Best overall matches first.
5. For each job calculate "match_score_pct" as percentage of required skills the candidate has.
6. Include a "growth_skills" field: 2-3 skills the candidate should learn for each role.
7. Include multi-platform apply URLs.

Return ONLY valid JSON (no markdown, no explanation):
{{
  "university": "University Name",
  "university_city": "City Name",
  "experience_level": "fresher|1-2 years|3-5 years|5+ years",
  "jobs": [
    {{
      "id": "job-1",
      "title": "Job Title",
      "company": "Real Indian Company Name",
      "location": "Indian City",
      "proximity": "Same City|Nearby|Distant",
      "ctc_min": 800000,
      "ctc_max": 1800000,
      "experience": "0-2 years",
      "job_type": "Full-time",
      "description": "3-4 sentence realistic job description",
      "required_skills": ["Skill1", "Skill2", "Skill3", "Skill4", "Skill5"],
      "matching_skills": ["Skills that match candidate"],
      "growth_skills": ["Skill to learn 1", "Skill to learn 2"],
      "why_good_fit": "1-2 sentence explanation of why this role suits the candidate",
      "apply_urls": {{
        "linkedin": "https://www.linkedin.com/jobs/search/?keywords=Job+Title&location=City",
        "naukri": "https://www.naukri.com/Job-Title-jobs-in-City",
        "indeed": "https://in.indeed.com/jobs?q=Job+Title&l=City"
      }}
    }}
  ]
}}"""
        def _fallback_job_payload() -> Dict[str, Any]:
            base_skills = user_skills[:8] if user_skills else ["Python", "SQL", "Problem Solving", "Communication", "Git"]
            role_templates = [
                ("Backend Developer", "Bengaluru"),
                ("Software Engineer", "Hyderabad"),
                ("Python Developer", "Pune"),
                ("Full Stack Developer", "Chennai"),
                ("Data Analyst", "Gurugram"),
                ("SDE I", "Noida"),
                ("API Developer", "Mumbai"),
                ("Junior Developer", "Kolkata"),
                ("Associate Software Engineer", "Ahmedabad"),
                ("Application Developer", "Bengaluru"),
            ]
            jobs_local: List[Dict[str, Any]] = []
            for idx, (title, city) in enumerate(role_templates, start=1):
                required = list(dict.fromkeys(base_skills[:5] + ["Problem Solving", "Communication"]))[:6]
                title_enc = title.replace(" ", "+")
                city_enc = city.replace(" ", "+")
                jobs_local.append({
                    "id": f"job-{idx}",
                    "title": title,
                    "company": f"India Tech Co {idx}",
                    "location": city,
                    "proximity": "Distant",
                    "ctc_min": 600000 + idx * 50000,
                    "ctc_max": 1200000 + idx * 80000,
                    "experience": "0-2 years",
                    "job_type": "Full-time",
                    "description": f"{title} role focused on engineering fundamentals, clean coding, and collaboration.",
                    "required_skills": required,
                    "growth_skills": ["System Design Basics", "Cloud Fundamentals"],
                    "why_good_fit": "Matches your current skill profile and entry-level experience.",
                    "apply_urls": {
                        "linkedin": f"https://www.linkedin.com/jobs/search/?keywords={title_enc}&location={city_enc}",
                        "naukri": f"https://www.naukri.com/{title.replace(' ', '-')}-jobs-in-{city.replace(' ', '-')}",
                        "indeed": f"https://in.indeed.com/jobs?q={title_enc}&l={city_enc}",
                    }
                })
            return {
                "university": "Not detected",
                "university_city": "Unknown",
                "experience_level": "fresher",
                "jobs": jobs_local,
            }

        parsed: Optional[Dict[str, Any]] = None
        provider = "fallback-local"
        raw_text = ""
        fallback_reason: Optional[str] = None

        def _is_valid_jobs_payload(payload: Optional[Dict[str, Any]]) -> bool:
            return bool(payload and isinstance(payload.get("jobs"), list) and len(payload.get("jobs", [])) > 0)

        try:
            raw_text, provider = await call_ai_with_fallback(
                messages=[
                    {"role": "system", "content": "You are a job market expert. Return only valid JSON."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                max_tokens=4000,
            )
            parsed = parse_json_response(raw_text)
            if not _is_valid_jobs_payload(parsed):
                raise ValueError("AI response missing jobs")
        except Exception as ai_err:
            # Secondary recovery: ask multiple providers in parallel before local fallback.
            logger.warning(f"Primary job AI call failed, retrying via parallel providers: {ai_err}")
            fallback_reason = str(ai_err)
            try:
                parallel = await call_ai_parallel(
                    messages=[
                        {"role": "system", "content": "You are a job market expert. Return only valid JSON."},
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0.7,
                    max_tokens=4000,
                    providers=["gemini", "deepseek", "openai", "claude"],
                )
                successes = parallel.get("successes", [])
                for success in successes:
                    maybe_parsed = parse_json_response(success.get("raw_text", ""))
                    if _is_valid_jobs_payload(maybe_parsed):
                        parsed = maybe_parsed
                        provider = f"parallel:{success.get('provider', 'unknown')}"
                        fallback_reason = None
                        break
            except Exception as parallel_err:
                fallback_reason = f"{fallback_reason}; parallel: {parallel_err}" if fallback_reason else str(parallel_err)

            if not _is_valid_jobs_payload(parsed):
                logger.warning(f"Job AI unavailable, serving fallback recommendations: {fallback_reason}")
                parsed = _fallback_job_payload()
                provider = "fallback-local"

        raw_jobs = parsed.get("jobs", []) if isinstance(parsed, dict) else []
        jobs = [j for j in (raw_jobs or []) if isinstance(j, dict)]
        if len(jobs) < len(raw_jobs or []):
            logger.warning("Dropped non-dict job entries from AI payload in /recommend-jobs")
        if not jobs:
            logger.warning("AI payload had no valid jobs after sanitization; using local fallback jobs")
            fallback_payload = _fallback_job_payload()
            jobs = fallback_payload.get("jobs", [])
            provider = "fallback-local"
            fallback_reason = (fallback_reason + "; invalid AI jobs payload") if fallback_reason else "invalid AI jobs payload"
        university = parsed.get("university", "Not detected")
        university_city = parsed.get("university_city", "Unknown")
        experience_level = parsed.get("experience_level", "unknown")

        # â”€â”€ Enhanced match scoring algorithm â”€â”€
        user_skills_lower = {s.lower() for s in user_skills}
        strong_skills_lower = {s.lower() for s in strong_skills}
        
        for i, job in enumerate(jobs):
            job["id"] = job.get("id", f"job-{i+1}")
            required_raw = job.get("required_skills", [])
            required = [s for s in (required_raw if isinstance(required_raw, list) else []) if isinstance(s, str)]
            matching = [s for s in required if s.lower() in user_skills_lower]
            strong_match = [s for s in matching if s.lower() in strong_skills_lower]
            
            # Weighted match: strong skills count double
            base_match = len(matching) / len(required) if required else 0
            strong_bonus = len(strong_match) / len(required) * 0.15 if required else 0
            match_pct = min(100, (base_match + strong_bonus) * 100)
            
            job["matching_skills"] = matching
            job["match_score_pct"] = round(match_pct, 1)
            job["match_score"] = 3 if match_pct >= 70 else 2 if match_pct >= 45 else 1
            job["missing_skills"] = [s for s in required if s not in matching]
            job["strong_matches"] = strong_match
            
            # Backward compat: ensure apply_urls exists
            if "apply_urls" not in job or not isinstance(job.get("apply_urls"), dict):
                title_enc = job.get("title", "").replace(" ", "+")
                loc_enc = job.get("location", "").replace(" ", "+")
                job["apply_urls"] = {
                    "linkedin": f"https://www.linkedin.com/jobs/search/?keywords={title_enc}&location={loc_enc}",
                    "naukri": f"https://www.naukri.com/{title_enc.replace('+', '-')}-jobs-in-{loc_enc.replace('+', '-')}",
                    "indeed": f"https://in.indeed.com/jobs?q={title_enc}&l={loc_enc}",
                }
            # Keep backward-compat apply_url
            if "apply_url" not in job:
                job["apply_url"] = job["apply_urls"].get("linkedin", "")

        # â”€â”€ Hybrid sort: match_score_pct (60%) + proximity (40%) â”€â”€
        proximity_score = {"Same City": 1.0, "Nearby": 0.6, "Distant": 0.2}
        jobs.sort(
            key=lambda j: (
                j.get("match_score_pct", 0) * 0.6
                + proximity_score.get(j.get("proximity", "Distant"), 0.2) * 40
            ),
            reverse=True,
        )

        # â”€â”€ Skill gap analysis â”€â”€
        all_required = set()
        for j in jobs:
            all_required.update(s.lower() for s in j.get("required_skills", []))
        skill_gap = sorted(all_required - user_skills_lower)

        return {
            "success": True,
            "user_skills": user_skills,
            "strong_skills": strong_skills,
            "weak_skills": weak_skills,
            "unverified_skills": unverified_skills[:10],
            "university": university,
            "university_city": university_city,
            "experience_level": experience_level,
            "jobs": jobs,
            "skill_gap": skill_gap[:15],
            "total_jobs": len(jobs),
            "jobs_source": provider,
            "is_live_generated": provider != "fallback-local",
            "fallback_reason": fallback_reason if provider == "fallback-local" else None,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Job recommendation error: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to recommend jobs: {str(e)}"
        )

@app.delete("/session/{session_id}")
async def delete_session(
    session_id: str,
    current_user: Dict = Depends(get_current_user)
):
    """
    Delete a user session
    """
    try:
        db = get_db()
        
        # Try to import ObjectId, fall back to mock
        try:
            from bson import ObjectId
            make_object_id = ObjectId
        except:
            from backend.db.mock_mongo import MockObjectId
            make_object_id = MockObjectId
        
        # Get session to verify ownership
        session = db.user_sessions.find_one({"_id": make_object_id(session_id)})
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        
        if session["user_id"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Not authorized")
        
        # Delete file if exists
        if "resume_path" in session and os.path.exists(session["resume_path"]):
            os.remove(session["resume_path"])
        
        # Delete session
        db.user_sessions.delete_one({"_id": make_object_id(session_id)})
        
        return {"message": "Session deleted successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Delete session error: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete session: {str(e)}"
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.api:app", host="0.0.0.0", port=8000, reload=True)

