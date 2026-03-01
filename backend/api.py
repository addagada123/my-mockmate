from fastapi import FastAPI, File, UploadFile, HTTPException, Depends, status, Response, BackgroundTasks
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import os
from datetime import datetime, timedelta
import shutil
import json as json_mod
import hashlib
import random
import openai  # type: ignore
import asyncio
import time
import httpx
from endeavor_rag_service import (
    interview_rag_pipeline,
    collection
)
from backend.db.mongo import get_db
from backend.auth.routes import router as auth_router
from backend.auth.utils import get_current_user, verify_password, get_password_hash
from jose import JWTError, jwt
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# --- Provider Health & Cost Tracking System (Approach 1B: Circuit Breaker) ---
class ProviderStats:
    """Track provider health, costs, and performance"""
    def __init__(self):
        self.stats = {
            "gemini": {"cost_per_1m": 0.075, "failures": 0, "successes": 0, "last_failure": None, "blocked_until": None},
            "claude": {"cost_per_1m": 0.80, "failures": 0, "successes": 0, "last_failure": None, "blocked_until": None},
            "openai": {"cost_per_1m": 0.30, "failures": 0, "successes": 0, "last_failure": None, "blocked_until": None},
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
    import re
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
        model = genai.GenerativeModel(os.getenv("GOOGLE_MODEL", "gemini-1.5-flash"))  # type: ignore  # pyright: ignore
        prompt_text = "\n\n".join(m["content"] for m in messages if m["role"] != "system")
        resp = await run_in_threadpool(
            lambda: model.generate_content(prompt_text, generation_config={"temperature": temperature, "max_output_tokens": max_tokens})
        )
        return resp.text or ""  # type: ignore  # pyright: ignore
    elif provider == "claude":
        import anthropic  # type: ignore  # pyright: ignore
        anthropic_key = os.getenv("ANTHROPIC_API_KEY")
        if not anthropic_key:
            raise ValueError("Anthropic API key not configured")
        acl = anthropic.Anthropic(api_key=anthropic_key)
        user_msgs: Any = [{"role": m["role"], "content": m["content"]} for m in messages if m["role"] != "system"]
        resp_claude: Any = await run_in_threadpool(  # pyright: ignore
            lambda: acl.messages.create(model=os.getenv("ANTHROPIC_MODEL", "claude-3-haiku-20240307"), max_tokens=max_tokens, messages=user_msgs)  # pyright: ignore
        )
        # Safely extract text from the first content block
        block = resp_claude.content[0] if resp_claude.content else None  # pyright: ignore
        return getattr(block, "text", "") or ""  # pyright: ignore
    elif provider == "openai":
        openai_key = os.getenv("OPENAI_API_KEY")
        if not openai_key:
            raise ValueError("OpenAI API key not configured")
        client = openai.OpenAI(api_key=openai_key)
        resp = await run_in_threadpool(
            lambda: client.chat.completions.create(model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"), messages=messages, temperature=temperature, max_tokens=max_tokens)  # type: ignore
        )
        return resp.choices[0].message.content or ""
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
        except Exception as e:
            provider_stats.record_failure(prov)
            errors.append(f"{prov}: {str(e)[:50]}")
            raise
    
    try:
        # Primary provider with 5s timeout before parallel fallback
        try:
            result, provider = await asyncio.wait_for(run_provider(primary_provider), timeout=5)
            return result, provider
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
        "c": [" c ", " c,", "\\bc\\b"],  # Avoid matching C in other words
        "kotlin": ["kotlin"],
        "swift": ["swift"],
        "csharp": ["c#", "csharp", "c-sharp"],
        "ruby": ["ruby"],
        "php": ["php"],
        "golang": ["golang", "go"],
        "rust": ["rust"],
        "scala": ["scala"],
        "r": [" r ", " r,"],  # R language
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
    """Lightweight semantic similarity using keyword overlap (Approach 2D: Duplicate Detection)"""
    keywords1 = set(w.lower() for w in text1.split() if len(w) > 4)
    keywords2 = set(w.lower() for w in text2.split() if len(w) > 4)
    if not keywords1 or not keywords2:
        return 0.0
    overlap = len(keywords1 & keywords2)
    union = len(keywords1 | keywords2)
    return overlap / union if union > 0 else 0.0

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
    
    # Generate questions using templates with semantic duplicate detection
    while len(results) < count and attempts < len(pool):
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
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
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

# Upload directory
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

def simple_evaluate_answer(question: str, user_answer: str, correct_answer: str = "") -> Dict:
    """Simple keyword-based answer evaluation"""
    if not user_answer or not user_answer.strip():
        return {"score": 0, "feedback": "No answer provided", "is_correct": False}
    
    # Simple keyword matching
    user_answer_lower = user_answer.lower()
    question_lower = question.lower()
    
    # Extract keywords from question
    keywords = [word for word in question_lower.split() if len(word) > 4]
    
    # Count matching keywords
    matches = sum(1 for keyword in keywords if keyword in user_answer_lower)
    match_ratio = matches / len(keywords) if keywords else 0
    
    # Calculate score (0-100)
    score = min(100, int(match_ratio * 100) + (20 if len(user_answer.split()) > 10 else 0))
    
    is_correct = score >= 60
    feedback = "Good answer!" if is_correct else "Could be improved with more details"
    
    return {"score": score, "feedback": feedback, "is_correct": is_correct}

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

        # Stage 1: Check byte-exact match (fastest)
        cached_resume = db.resume_question_cache.find_one({"resume_hash": resume_hash})
        
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
                "all_questions": all_cached_questions,
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
            result = await run_in_threadpool(interview_rag_pipeline, file_path, collection)
            
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
                "all_questions": questions,  # Store all questions for section-based generation
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

        questions = latest_session.get("questions", [])

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
            filtered_questions = [
                q for q in filtered_questions
                if (q.get("difficulty") or "").strip().lower() == normalized_diff
            ]

        if topic or difficulty:
            questions = filtered_questions

        min_required = 5 if difficulty else 0
        existing_questions = { (q.get("question") or "").strip().lower() for q in questions }

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

        questions = session.get("questions", [])

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
            filtered_questions = [
                q for q in filtered_questions
                if (q.get("difficulty") or "").strip().lower() == normalized_diff
            ]

        if payload.topic or payload.difficulty:
            questions = filtered_questions

        num_questions = payload.num_questions or 10
        min_required = 5 if payload.difficulty else 0
        target_count = max(num_questions, min_required) if min_required else num_questions

        existing_questions = { (q.get("question") or "").strip().lower() for q in questions }
        if target_count and len(questions) < target_count:
            questions.extend(
                _generate_topic_questions(
                    payload.topic,
                    payload.difficulty,
                    target_count - len(questions),
                    existing_questions,
                    session_id=str(session.get("_id"))
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
}

# Compiled languages that should early-bail on compile errors
_COMPILED_LANGS = {"java", "cpp", "c++", "c", "typescript"}

PISTON_URL = "https://emkc.org/api/v2/piston/execute"


async def _execute_single(
    client: httpx.AsyncClient, lang_info: dict, lang_key: str,
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

    except httpx.TimeoutException:
        return {
            "test_case": index, "input": stdin_input, "expected": expected,
            "actual": "", "passed": False,
            "error": "Time Limit Exceeded (10s)", "_compile_error": False,
        }
    except Exception as e:
        return {
            "test_case": index, "input": stdin_input, "expected": expected,
            "actual": "", "passed": False,
            "error": str(e)[:300], "_compile_error": False,
        }


@app.post("/run-code")
async def run_code(
    payload: RunCodeRequest,
    current_user: Dict = Depends(get_current_user)
):
    """
    Execute code against test cases using the Piston API.
    - Compiled languages: run first test case to check compilation, then run rest concurrently.
    - Interpreted languages: run ALL test cases concurrently from the start.
    Returns per-test-case results with pass/fail, score, and execution time.
    """
    start_time = time.time()

    lang_key = payload.language.strip().lower()
    lang_info = PISTON_LANG_MAP.get(lang_key)
    if not lang_info:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported language: {payload.language}. Supported: {', '.join(PISTON_LANG_MAP.keys())}"
        )

    test_cases = payload.test_cases or []
    if not test_cases:
        test_cases = [{"input": "", "expected_output": ""}]

    results: list[dict] = []
    is_compiled = lang_key in _COMPILED_LANGS

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(60.0, connect=10.0),
        limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
    ) as client:

        if is_compiled and len(test_cases) > 1:
            # --- Strategy: compile-check first, then parallel ---
            first_tc = test_cases[0]
            first_result = await _execute_single(
                client, lang_info, lang_key, payload.code,
                first_tc.get("input", ""),
                first_tc.get("expected_output", "").strip(),
                1,
            )
            results.append(first_result)

            if first_result.get("_compile_error"):
                # Compile failed — propagate same error to all remaining test cases
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
                # Compilation OK — run remaining test cases concurrently
                tasks = [
                    _execute_single(
                        client, lang_info, lang_key, payload.code,
                        tc.get("input", ""),
                        tc.get("expected_output", "").strip(),
                        i,
                    )
                    for i, tc in enumerate(test_cases[1:], start=2)
                ]
                remaining = await asyncio.gather(*tasks)
                results.extend(remaining)
        else:
            # --- Strategy: run ALL test cases concurrently ---
            tasks = [
                _execute_single(
                    client, lang_info, lang_key, payload.code,
                    tc.get("input", ""),
                    tc.get("expected_output", "").strip(),
                    i,
                )
                for i, tc in enumerate(test_cases, start=1)
            ]
            results = await asyncio.gather(*tasks)
            results = list(results)

    # Strip internal _compile_error flag before returning
    for r in results:
        r.pop("_compile_error", None)

    # Sort by test_case number to maintain order
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
        "javascript": "js", "js": "js", "c": "c", "typescript": "ts",
    }
    return ext_map.get(lang, "txt")

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

        db.user_sessions.update_one(
            {"_id": session_id_obj},
            {
                "$set": {
                    "status": "completed",
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
                        "tab_switches": submission.tab_switches
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
    Get user performance history
    """
    try:
        db = get_db()
        
        # Get all sessions for user (completed + in_progress)
        sessions = list(db.user_sessions.find(
            {
                "user_id": current_user["id"]
            },
            {
                "_id": 1,
                "created_at": 1,
                "completed_at": 1,
                "total_score": 1,
                "max_score": 1,
                "percentage": 1,
                "skills": 1,
                "status": 1,
                "topic": 1,
                "difficulty": 1,
                "time_spent": 1,
                "test_attempts": 1,
            }
        ).sort("created_at", -1))
        
        # Convert ObjectIds to strings
        for session in sessions:
            session["_id"] = str(session["_id"])
        
        # Calculate overall stats
        attempts = []
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
                })

        total_tests = len(attempts)
        avg_score = sum(a.get("score", 0) for a in attempts) / total_tests if total_tests > 0 else 0
        accuracy_rate = (
            sum(1 for a in attempts if (a.get("score") or 0) >= 70) / total_tests * 100
        ) if total_tests > 0 else 0

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
            })

        stats = {
            "totalTests": total_tests,
            "averageScore": round(avg_score, 2),
            "accuracyRate": round(accuracy_rate, 2),
        }

        return {
            "success": True,
            "results": results,
            "stats": stats,
            "total_tests": total_tests,
            "average_score": round(avg_score, 2),
            "sessions": sessions,
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

        raw_text, provider = await call_ai_with_fallback(
            messages=[
                {"role": "system", "content": "You are an assessment designer. Return only valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=4000,
        )

        parsed = parse_json_response(raw_text)

        if not parsed or "sections" not in parsed:
            logger.error(f"AI comm test parse fail ({provider}): {raw_text[:500]}")
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
    Recommend real-time jobs in India using GPT, sorted by proximity to
    the university mentioned in the candidate's resume.
    """
    try:
        db = get_db()

        # Get user's latest session to extract skills & resume path
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

        # --- Call AI for real-time India-based job recommendations ---
        skills_str = ", ".join(user_skills[:20])  # cap to avoid token overflow

        # Trim resume text for the prompt (first 2000 chars is enough for education)
        resume_snippet = resume_text[:2000] if resume_text else "(resume text unavailable)"

        prompt = f"""You are an expert Indian tech job market analyst with real-time knowledge of current job openings in India as of today.

CANDIDATE PROFILE:
- Skills: {skills_str}
- Resume excerpt (for university/education detection):
\"\"\"
{resume_snippet}
\"\"\"

TASK:
1. First, identify the university/college the candidate attended from their resume. Output it in the "university" field. Also identify the city where that university is located in "university_city".
2. Generate exactly 8 realistic, currently-active job openings in India that match this candidate's skill set. These should resemble real jobs that would be posted on LinkedIn, Naukri, or Indeed India right now.
3. ALL jobs must be based in India (Indian cities only).
4. Sort jobs by proximity to the candidate's university city:
   - Jobs in the SAME city as the university come first
   - Jobs in NEARBY cities come next
   - Jobs in DISTANT cities come last
5. Each job must include a "proximity" field: "Same City", "Nearby", or "Distant"
6. Each job must include an "apply_url" field with a realistic job search URL (use LinkedIn job search or Naukri search URL with the job title and location).

Return ONLY valid JSON (no markdown, no explanation) in this exact structure:
{{
  "university": "University Name",
  "university_city": "City Name",
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
      "description": "2-3 sentence realistic job description",
      "required_skills": ["Skill1", "Skill2", "Skill3"],
      "matching_skills": ["Skills that match candidate"],
      "apply_url": "https://www.linkedin.com/jobs/search/?keywords=Job+Title&location=City"
    }}
  ]
}}"""

        raw_text, provider = await call_ai_with_fallback(
            messages=[
                {"role": "system", "content": "You are a job market expert. Return only valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=3000,
        )

        parsed = parse_json_response(raw_text)

        if not parsed or "jobs" not in parsed:
            logger.error(f"AI job response parse fail ({provider}): {raw_text[:500]}")
            raise HTTPException(status_code=500, detail="Failed to parse job recommendations")

        jobs = parsed.get("jobs", [])
        university = parsed.get("university", "Not detected")
        university_city = parsed.get("university_city", "Unknown")

        # Add match_score levels based on matching_skills count
        for i, job in enumerate(jobs):
            job["id"] = job.get("id", f"job-{i+1}")
            matching = job.get("matching_skills", [])
            required = job.get("required_skills", [])
            match_pct = (len(matching) / len(required) * 100) if required else 0
            job["match_score"] = 3 if match_pct >= 75 else 2 if match_pct >= 50 else 1
            job["match_score_pct"] = round(match_pct, 1)
            job["missing_skills"] = [s for s in required if s not in matching]

        return {
            "success": True,
            "user_skills": user_skills,
            "university": university,
            "university_city": university_city,
            "jobs": jobs,
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
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
