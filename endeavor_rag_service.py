from pymongo import MongoClient
from langchain_community.document_loaders import PyPDFLoader
from dotenv import load_dotenv
from typing import List, Tuple, Optional
import os
import random
import hashlib
import time
import numpy as np
import json
import logging

load_dotenv()

# ------------------ MONGODB ------------------

MONGO_URI = os.getenv("MONGO_URI")

if not MONGO_URI:
    user = os.getenv("MONGO_USER")
    pwd = os.getenv("MONGO_PASSWORD")
    host = os.getenv("MONGO_HOST", "localhost:27017")
    db = os.getenv("MONGO_DB", "Endeavor")

    if user and pwd:
        MONGO_URI = f"mongodb+srv://{user}:{pwd}@{host}/{db}"
    else:
        MONGO_URI = f"mongodb://{host}/{db}"

try:
    client = MongoClient(MONGO_URI)
    db = client[os.getenv("MONGO_DB", "Endeavor")]
    collection = db[os.getenv("MONGO_COLLECTION", "ragCollection")]
except Exception as e:
    print("Mongo connection failed:", e)
    collection = None

# ------------------ SESSION ------------------

class InterviewSession:
    def __init__(self, resume_path: str):
        seed = f"{resume_path}_{int(time.time())}"
        self.session_id = hashlib.md5(seed.encode()).hexdigest()[:8]
        self.seed = int(self.session_id, 16) % 2**31
        random.seed(self.seed)
        np.random.seed(self.seed)

# ------------------ SKILL EXTRACTION ------------------

def extract_skills_from_resume(resume_pdf_path: str) -> Tuple[List[str], List[str], str]:
    loader = PyPDFLoader(resume_pdf_path)
    docs = loader.load()
    text = "\n".join(d.page_content for d in docs)

    # Basic skills (kept broad; topics will be fully dynamic)
    skills = [
        "Python", "Java", "C++", "SQL", "MongoDB", "React",
        "FastAPI", "Flask", "Django", "Machine Learning",
        "Data Structures", "Algorithms", "System Design",
        "AWS", "Docker", "Kubernetes", "NLP", "RAG"
    ]

    found_skills = [s for s in skills if s.lower() in text.lower()]

    # Whitelist-based technical topic extraction
    import re
    
    # Comprehensive whitelist of technical skills, tools, and domains
    technical_whitelist = {
        # Programming Languages
        "Python", "Java", "JavaScript", "TypeScript", "C++", "C#", "Go", "Rust", "Ruby", "PHP",
        "Swift", "Kotlin", "Scala", "R", "MATLAB", "Perl", "Dart", "Objective-C",
        # Web & Frameworks
        "React", "Angular", "Vue", "Node.js", "Django", "Flask", "FastAPI", "Spring", "Express",
        "Next.js", "Svelte", "Laravel", "Rails", "ASP.NET", "jQuery",
        # Databases
        "SQL", "MySQL", "PostgreSQL", "MongoDB", "Redis", "Cassandra", "Oracle", "SQLite",
        "DynamoDB", "Elasticsearch", "Neo4j", "MariaDB",
        # Cloud & DevOps
        "AWS", "Azure", "GCP", "Docker", "Kubernetes", "Jenkins", "GitLab", "GitHub", "Terraform",
        "Ansible", "CI/CD", "Linux", "Unix", "Nginx", "Apache",
        # Data Science & AI
        "TensorFlow", "PyTorch", "Keras", "Scikit-learn", "Pandas", "NumPy", "Matplotlib",
        "Tableau", "PowerBI", "Spark", "Hadoop", "Airflow", "Kafka",
        # Mobile
        "Android", "iOS", "Flutter", "ReactNative", "Xamarin",
        # Engineering & CAD
        "CAD", "CAM", "SolidWorks", "AutoCAD", "CATIA", "Creo", "ANSYS", "MATLAB", "Simulink",
        "FEA", "CFD", "CNC", "PLC", "SCADA", "LabVIEW",
        # Other Tech
        "Blockchain", "IoT", "AR", "VR", "API", "GraphQL", "gRPC", "Microservices", "WebSockets",
        "OAuth", "JWT", "Agile", "Scrum", "Git", "Linux"
    }
    
    # Normalize whitelist to lowercase for comparison
    tech_lower = {t.lower() for t in technical_whitelist}
    
    # Extract all words and match against whitelist
    tokens = re.findall(r"[A-Za-z][A-Za-z\-\.]{2,}", text)
    found_topics = {}
    
    for token in tokens:
        tl = token.lower()
        # Check if it matches a whitelisted tech term
        if tl in tech_lower:
            # Find the canonical casing
            canonical = next((t for t in technical_whitelist if t.lower() == tl), token.capitalize())
            found_topics[canonical] = found_topics.get(canonical, 0) + 1
    
    # Also check for known acronyms (uppercase only)
    known_acronyms = {
        "AI", "ML", "NLP", "API", "SQL", "AWS", "GCP", "IoT", "CI", "CD", "REST", "JSON",
        "HTML", "CSS", "UI", "UX", "CAD", "CAM", "FEA", "CFD", "CNC", "PLC", "HVAC", "SCADA",
        "ERP", "CRM", "ETL", "BI", "GPU", "CPU", "RAM", "SSD", "LAN", "VPN", "DNS", "HTTP",
        "HTTPS", "TCP", "UDP", "IP", "AR", "VR", "JWT", "OAuth"
    }
    
    acronyms = re.findall(r"\b[A-Z]{2,6}\b", text)
    for ac in acronyms:
        if ac in known_acronyms:
            found_topics[ac] = found_topics.get(ac, 0) + 3
    
    # Sort by frequency and take top 8 unique topics
    sorted_topics = sorted(found_topics.items(), key=lambda x: x[1], reverse=True)
    topics_detected = [topic for topic, _ in sorted_topics[:8]]
    
    # If no whitelisted topics found, return empty list (no generic fallback)
    if not topics_detected:
        topics_detected = []

    return list(set(found_skills)), topics_detected, text


# ------------------ GEMINI QUESTION GENERATION ------------------

def generate_resume_questions_with_gemini(
    topic: str,
    resume_text: str,
    count: int = 5,
    skills: Optional[List[str]] = None,
    topics: Optional[List[str]] = None,
    difficulty: str = "medium",
) -> List[dict]:
    """Generate resume-grounded questions for a topic using Gemini.

    Returns a list of dicts with keys: question, answer, difficulty, topic.
    Falls back to empty on any failure so the caller can decide next steps.
    """
    try:
        from langchain_google_genai import ChatGoogleGenerativeAI

        # Keep prompt compact to control token usage
        snippet = resume_text[:2400]
        skills_text = ", ".join(skills or [])
        topics_text = ", ".join(topics or [])
        prompt = (
            "You are generating interview questions grounded ONLY in the candidate's resume content.\n"
            f"Resume snippet (partial):\n{snippet}\n\n"
            f"Detected skills: {skills_text}\n"
            f"Detected topics: {topics_text}\n"
            f"Focus topic for the questions: {topic}\n"
            f"Generate {count} {difficulty}-level, scenario-based Q&A pairs that reflect this resume.\n"
            "Vary the phrasing and structure—no repeating patterns like 'three core concepts' or 'common pitfalls'.\n"
            "Anchor each question in resume-relevant details (projects, tools, domains).\n"
            "Return JSON only with key 'questions' as an array. Each item must have: "
            "question, answer, difficulty (use the exact difficulty value provided), topic (use the exact focus topic)."
        )

        model = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            temperature=0.5,
            google_api_key=os.getenv("GOOGLE_API_KEY")
        )
        llm_result = model.invoke(prompt)
        raw_text = getattr(llm_result, "content", None) or str(llm_result)
        
        # Log the raw Gemini response for debugging
        print(f"\n[DEBUG] Gemini raw response for topic '{topic}':")
        print(f"[DEBUG] {raw_text[:500]}...")  # First 500 chars
        
        # Strip markdown code blocks if present
        cleaned_text = raw_text.strip()
        if cleaned_text.startswith("```json"):
            cleaned_text = cleaned_text[7:]  # Remove ```json
        if cleaned_text.startswith("```"):
            cleaned_text = cleaned_text[3:]  # Remove ```
        if cleaned_text.endswith("```"):
            cleaned_text = cleaned_text[:-3]  # Remove trailing ```
        cleaned_text = cleaned_text.strip()

        if cleaned_text and (not cleaned_text.startswith("{") or not cleaned_text.endswith("}")):
            start = cleaned_text.find("{")
            end = cleaned_text.rfind("}")
            if start != -1 and end != -1 and end > start:
                cleaned_text = cleaned_text[start:end + 1].strip()
        
        data = json.loads(cleaned_text)
        parsed = data.get("questions", []) if isinstance(data, dict) else []
        
        print(f"[DEBUG] Parsed {len(parsed)} questions from Gemini for topic '{topic}'")

        normalized: List[dict] = []
        for q in parsed:
            normalized.append({
                "question": str(q.get("question", "")).strip(),
                "answer": str(q.get("answer", "")).strip(),
                "difficulty": q.get("difficulty", difficulty),
                "topic": q.get("topic", topic),
            })
        return normalized
    except Exception as e:
        print(f"[WARN] Gemini resume question generation failed for topic '{topic}': {e}")
        import traceback
        traceback.print_exc()
        return []

# ------------------ MAIN PIPELINE ------------------

def interview_rag_pipeline(resume_pdf_path: str, collection):
    if collection is None:
        raise RuntimeError("MongoDB not connected")

    skills, topics, resume_text = extract_skills_from_resume(resume_pdf_path)
    session = InterviewSession(resume_pdf_path)

    # 1) Generate resume-grounded questions with Gemini only (no RAG/templates)
    # Generate 10 questions per difficulty for top 4 topics (up to 120 questions total)
    questions: List[dict] = []
    gen_topics = topics if topics else skills
    gen_topics = gen_topics[:4]  # Limit to top 4 topics as requested
    difficulties = ["easy", "medium", "hard"]
    questions_source = "resume-gemini-only"
    
    import concurrent.futures
    
    def generate_for_topic_difficulty(t, diff):
        return generate_resume_questions_with_gemini(
            t,
            resume_text,
            10,  # 10 questions per difficulty per topic (2 topics * 3 difficulties * 10 = 60 questions)
            skills=skills,
            topics=topics,
            difficulty=diff,
        )
    
    # Generate with limited parallelism to avoid quota exhaustion
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        futures = []
        for t in gen_topics:
            for diff in difficulties:
                future = executor.submit(generate_for_topic_difficulty, t, diff)
                futures.append(future)
        
        for future in concurrent.futures.as_completed(futures):
            try:
                generated = future.result()
                if generated:
                    questions.extend(generated)
            except Exception as e:
                print(f"[WARN] Parallel generation failed: {e}")

    # If Gemini produced nothing, synthesize a small resume-grounded fallback set so the user can proceed
    if not questions:
        print("[WARN] Gemini returned 0 questions; using deterministic resume-based fallback prompts.")
        fallback_topics = gen_topics or ["General"]
        fallback_questions: List[dict] = []
        # Generate 10 fallback questions per difficulty per topic (mirrors Gemini target count)
        for t in fallback_topics:
            for diff in difficulties:
                for i in range(10):
                    fallback_questions.append({
                        "question": (
                            f"[{diff.title()}] Resume project deep-dive {i+1} on {t}: describe the problem, your approach, tools, and measurable impact."
                        ),
                        "answer": "Provide a concise STAR-style walkthrough grounded in your resume: situation, task, actions, results.",
                        "difficulty": diff,
                        "topic": t,
                    })
        questions = fallback_questions  # Up to 4 topics * 3 difficulties * 10 = 120
        questions_source = "resume-fallback"

    random.shuffle(questions)

    return {
        "sessionId": session.session_id,
        "skillsDetected": skills,
        "topicsDetected": topics,
        "questionCount": len(questions),
        "questions": questions,
        "questionVersion": 3,
        "questionsSource": questions_source,
    }
