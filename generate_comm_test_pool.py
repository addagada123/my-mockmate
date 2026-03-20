#!/usr/bin/env python3
"""
Pre-generate communication test pool and store in MongoDB.

Usage:
    python generate_comm_test_pool.py                  # Generate 5 tests per difficulty (15 total)
    python generate_comm_test_pool.py --count 10       # Generate 10 tests per difficulty (30 total)
    python generate_comm_test_pool.py --difficulty easy # Generate only Easy tests
    python generate_comm_test_pool.py --status          # Show pool status

This script calls GPT once per test and saves the result in the
`comm_test_pool` MongoDB collection. The /generate-comm-test endpoint
will then serve tests from this pool instead of calling GPT in real-time.
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime


import openai
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

# ---------- Config ----------
DIFFICULTIES = ["easy", "medium", "hard"]

PROMPT_TEMPLATE = """You are an expert corporate communication assessment designer used by top companies like TCS, Infosys, Wipro, Cognizant, and Accenture for hiring.

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


def get_db():
    """Connect to MongoDB and return the database."""
    mongodb_uri = (
        os.getenv("MONGODB_URI")
        or os.getenv("MONGO_URI")
        or "mongodb://localhost:27017/"
    )
    database_name = os.getenv("DATABASE_NAME") or os.getenv("MONGO_DB") or "endeavor_rag"
    client = MongoClient(mongodb_uri, serverSelectionTimeoutMS=5000, tlsAllowInvalidCertificates=True, tls=True)
    client.server_info()  # Force connection check
    return client[database_name]


def generate_one_test(client: openai.OpenAI, difficulty: str) -> dict | None:
    """Call GPT to generate one communication test. Returns parsed dict or None."""
    prompt = PROMPT_TEMPLATE.format(difficulty=difficulty.capitalize())
    try:
        resp = client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            messages=[
                {"role": "system", "content": "You are an assessment designer. Return only valid JSON."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.9,  # Higher temp for variety
            max_tokens=4000,
        )
        raw = resp.choices[0].message.content or ""

        # Parse JSON
        parsed = None
        try:
            parsed = json.loads(raw)
        except Exception:
            import re
            m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.S)
            if m:
                try:
                    parsed = json.loads(m.group(1))
                except Exception:
                    pass
            if not parsed:
                start = raw.find("{")
                end = raw.rfind("}")
                if start != -1 and end > start:
                    try:
                        parsed = json.loads(raw[start : end + 1])
                    except Exception:
                        pass

        if parsed and "sections" in parsed:
            return parsed
        print(f"  [WARN] Could not parse GPT response for {difficulty}")
        return None

    except openai.RateLimitError as e:
        print(f"  [ERROR] Rate limit hit: {e}")
        return None
    except Exception as e:
        print(f"  [ERROR] GPT call failed: {e}")
        return None


def show_status(db):
    """Print the current pool status."""
    print("\n=== Communication Test Pool Status ===")
    for diff in DIFFICULTIES:
        count = db.comm_test_pool.count_documents({"difficulty": diff})
        print(f"  {diff.capitalize():8s}: {count} tests")
    total = db.comm_test_pool.count_documents({})
    print(f"  {'Total':8s}: {total} tests")
    print()


def main():
    parser = argparse.ArgumentParser(description="Pre-generate communication test pool")
    parser.add_argument("--count", type=int, default=5, help="Tests to generate per difficulty (default: 5)")
    parser.add_argument("--difficulty", choices=DIFFICULTIES, help="Generate only for this difficulty")
    parser.add_argument("--status", action="store_true", help="Show pool status and exit")
    args = parser.parse_args()

    # Connect to DB
    try:
        db = get_db()
        print("Connected to MongoDB")
    except Exception as e:
        print(f"Failed to connect to MongoDB: {e}")
        sys.exit(1)

    if args.status:
        show_status(db)
        return

    # Check OpenAI key
    openai_key = os.getenv("OPENAI_API_KEY")
    if not openai_key:
        print("ERROR: OPENAI_API_KEY not set")
        sys.exit(1)

    client = openai.OpenAI(api_key=openai_key)
    difficulties = [args.difficulty] if args.difficulty else DIFFICULTIES

    print(f"\nGenerating {args.count} tests per difficulty: {difficulties}")
    show_status(db)

    total_generated = 0
    for diff in difficulties:
        existing = db.comm_test_pool.count_documents({"difficulty": diff})
        print(f"\n--- {diff.capitalize()} (existing: {existing}) ---")

        for i in range(args.count):
            print(f"  Generating test {i + 1}/{args.count}...", end=" ", flush=True)
            parsed = generate_one_test(client, diff)
            if parsed:
                db.comm_test_pool.insert_one({
                    "difficulty": diff,
                    "test_data": parsed,
                    "created_at": datetime.now(),
                    "times_served": 0,
                })
                total_generated += 1
                print("OK")
            else:
                print("FAILED")

            # Small delay to avoid rate limits
            if i < args.count - 1:
                time.sleep(2)

    print(f"\nDone! Generated {total_generated} new tests.")
    show_status(db)


if __name__ == "__main__":
    main()
