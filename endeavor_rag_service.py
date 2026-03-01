from pymongo import MongoClient
# Note: local sentence-transformers are not used in this deployment. Embeddings
# should be provided by external services if required.
import re
import random
import hashlib
import time
from datetime import datetime
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_community.document_loaders import PyPDFLoader
from dotenv import load_dotenv
from typing import List, Dict, Tuple
import os
import tempfile
import json
import numpy as np
from pydantic import BaseModel, Field, ValidationError, root_validator, SecretStr
from typing import Literal, Optional

# Load environment variables on import so ADC / API keys are available
load_dotenv()

# --- LLM Factory ---
def _create_llm_for_provider(provider: str, temperature: float = 0.8):
    """Create an LLM instance for a specific provider."""
    if provider == "openai":
        from langchain_openai import ChatOpenAI
        model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not set")
        return ChatOpenAI(
            model=model,
            temperature=temperature,
            api_key=SecretStr(api_key),
            timeout=60,
        )
    elif provider == "google":
        model = os.getenv("GOOGLE_MODEL", "gemini-1.5-flash")
        api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
        kwargs = {"model": model, "temperature": temperature}
        if api_key:
            kwargs["google_api_key"] = api_key
        return ChatGoogleGenerativeAI(**kwargs)
    elif provider == "anthropic":
        from langchain_anthropic import ChatAnthropic
        model = os.getenv("ANTHROPIC_MODEL", "claude-3-haiku-20240307")
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set")
        return ChatAnthropic(
            model_name=model,
            temperature=temperature,
            api_key=SecretStr(api_key),
            timeout=60,
            stop=None,
        )
    raise RuntimeError(f"Unsupported provider: {provider}")


def get_llm():
    """Return an LLM with multi-provider fallback: OpenAI -> Gemini -> Claude."""
    temperature = float(os.getenv("LLM_TEMPERATURE", "0.8"))

    # Build ordered list of available providers
    providers = []
    primary = os.getenv("LLM_PROVIDER", "openai").lower()
    if primary in {"openai", "gpt"}:
        primary = "openai"
    elif primary in {"google", "gemini"}:
        primary = "google"
    elif primary in {"anthropic", "claude"}:
        primary = "anthropic"

    # Primary first, then others
    all_providers = ["openai", "google", "anthropic"]
    if primary in all_providers:
        providers.append(primary)
    for p in all_providers:
        if p not in providers:
            providers.append(p)

    # Filter to only providers with API keys configured
    available = []
    for p in providers:
        if p == "openai" and os.getenv("OPENAI_API_KEY"):
            available.append(p)
        elif p == "google" and (os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")):
            available.append(p)
        elif p == "anthropic" and os.getenv("ANTHROPIC_API_KEY"):
            available.append(p)

    last_error = None
    for provider in available:
        try:
            llm = _create_llm_for_provider(provider, temperature)
            print(f"[get_llm] Using provider: {provider}")
            return llm
        except Exception as e:
            last_error = e
            print(f"[get_llm] Provider {provider} init failed: {e}, trying next...")

    if not available:
        raise RuntimeError("No AI provider API keys configured (set OPENAI_API_KEY, GOOGLE_API_KEY, or ANTHROPIC_API_KEY)")
    raise RuntimeError(f"All LLM providers failed. Last error: {last_error}")


def call_llm_with_fallback(prompt: str) -> str:
    """Call LLM with multi-provider fallback at invoke time. Returns raw text."""
    temperature = float(os.getenv("LLM_TEMPERATURE", "0.8"))

    providers = []
    primary = os.getenv("LLM_PROVIDER", "openai").lower()
    if primary in {"openai", "gpt"}:
        primary = "openai"
    elif primary in {"google", "gemini"}:
        primary = "google"
    elif primary in {"anthropic", "claude"}:
        primary = "anthropic"

    all_providers = ["openai", "google", "anthropic"]
    if primary in all_providers:
        providers.append(primary)
    for p in all_providers:
        if p not in providers:
            providers.append(p)

    available = []
    for p in providers:
        if p == "openai" and os.getenv("OPENAI_API_KEY"):
            available.append(p)
        elif p == "google" and (os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")):
            available.append(p)
        elif p == "anthropic" and os.getenv("ANTHROPIC_API_KEY"):
            available.append(p)

    last_error = None
    for provider in available:
        try:
            llm = _create_llm_for_provider(provider, temperature)
            response = llm.invoke(prompt)
            if hasattr(response, 'content'):
                text = response.content
            elif hasattr(response, 'text'):
                text = response.text
            else:
                text = str(response)
            print(f"[call_llm_with_fallback] Success with {provider}")
            return text
        except Exception as e:
            last_error = e
            print(f"[call_llm_with_fallback] Provider {provider} failed: {e}, trying next...")

    raise RuntimeError(f"All LLM providers failed. Last error: {last_error}")

# --- Connect to MongoDB ---
# Prefer a full connection string in MONGO_URI. If not provided, build from parts.
MONGO_URI = os.getenv("MONGO_URI")
if not MONGO_URI:
    MONGO_USER = os.getenv("MONGO_USER")
    MONGO_PASSWORD = os.getenv("MONGO_PASSWORD")
    MONGO_HOST = os.getenv("MONGO_HOST", "localhost:27017")
    MONGO_DB = os.getenv("MONGO_DB", "Endeavor")
    # If user/password provided, assume a SRV-style URI (Atlas)
    if MONGO_USER and MONGO_PASSWORD:
        # Note: host for Atlas should be like cluster0.btgym.mongodb.net
        MONGO_URI = f"mongodb+srv://{MONGO_USER}:{MONGO_PASSWORD}@{MONGO_HOST}/{MONGO_DB}?retryWrites=true&w=majority"
    else:
        # Fallback to a plain mongodb URI
        MONGO_URI = os.getenv("MONGO_URI", f"mongodb://{MONGO_HOST}/{MONGO_DB}")

try:
    client = MongoClient(
        MONGO_URI,
        tlsAllowInvalidCertificates=True,
        serverSelectionTimeoutMS=5000,
        connectTimeoutMS=5000,
        socketTimeoutMS=10000,
    )
    db_name = os.getenv("MONGO_DB", "Endeavor")
    db = client[db_name]
    collection_name = os.getenv("MONGO_COLLECTION", "ragCollection")
    collection = db[collection_name]
except Exception as e:
    # Log helpful message but don't crash import; endpoints will raise clearer errors if DB is required
    print(f"[endeavor_rag_service] Warning: could not connect to MongoDB with URI={MONGO_URI}: {e}")
    client = None
    db = None
    collection = None

# No local embedder in this deployment. Keep a placeholder variable for
# backward compatibility; functions should not rely on it being populated.
embedder = None

# --- Session-based randomization ---
class InterviewSession:
    def __init__(self, resume_path: str):
        # Create unique session ID based on resume path + timestamp
        session_data = f"{resume_path}_{int(time.time())}"
        self.session_id = hashlib.md5(session_data.encode()).hexdigest()[:8]
        
        # Set random seed based on session for reproducible randomness within session
        # but different across sessions
        self.random_seed = int(self.session_id, 16) % 2147483647
        random.seed(self.random_seed)
        np.random.seed(self.random_seed % 4294967295)
        
        # print(f"🎯 New Interview Session: {self.session_id}")
        # print(f"🎲 Random seed: {self.random_seed}")
        
        # Track used questions to avoid repetition within session
        self.used_questions = set()
        
        # Rotation strategies for variety
        self.difficulty_rotation = ["Easy", "Medium", "Hard"]
        self.topic_rotation_index = 0
        
    def get_rotation_weights(self) -> Dict[str, int]:
        """Get varied weights based on session - OPTIMIZED for speed"""
        base_weights = {
            "easy_medium": 3,
            "hard": 2,
            "dsa": 4,
            "behavioral": 2
        }
        
        # Introduce session-based variation (lighter variations)
        variations = [
            {"dsa": 5, "easy_medium": 2, "hard": 2, "behavioral": 2},  # DSA-focused
            {"dsa": 3, "easy_medium": 3, "hard": 2, "behavioral": 2},  # Balanced
            {"dsa": 2, "easy_medium": 2, "hard": 2, "behavioral": 4},  # Behavioral-focused
        ]
        
        session_variant = int(self.session_id, 16) % len(variations)
        return variations[session_variant]

# --- Enhanced Skills Extraction (same as before) ---
def extract_skills_from_resume(resume_pdf_path: str) -> Tuple[List[str], str]:
    """Extract technical skills and return resume text"""
    resume_loader = PyPDFLoader(resume_pdf_path)
    resume_docs = resume_loader.load()
    resume_text = "\n".join([doc.page_content for doc in resume_docs])

    # Comprehensive skill keywords
    skill_keywords = [
        # Programming Languages
        "Python", "Java", "C++", "C", "JavaScript", "TypeScript", "C#", "Go", "Rust", "Kotlin", "Swift",
        "PHP", "Ruby", "Scala", "R", "MATLAB", "Dart", "Objective-C",
        
        # Web Technologies
        "React", "Angular", "Vue.js", "Node.js", "Express", "Django", "Flask", "FastAPI", "Spring Boot",
        "Laravel", "Rails", "ASP.NET", "HTML", "CSS", "SASS", "SCSS", "Bootstrap", "Tailwind CSS",
        "jQuery", "Redux", "Next.js", "Nuxt.js",
        
        # Databases
        "SQL", "MySQL", "PostgreSQL", "MongoDB", "Redis", "SQLite", "Oracle", "Cassandra", "DynamoDB",
        "Neo4j", "InfluxDB", "Elasticsearch", "Firebase", "Supabase",
        
        # Cloud & DevOps
        "AWS", "Azure", "GCP", "Docker", "Kubernetes", "Jenkins", "CI/CD", "Terraform", "Ansible",
        "Git", "GitHub", "GitLab", "Linux", "Ubuntu", "CentOS", "Docker Compose", "Helm", "Prometheus",
        
        # Data Science & ML
        "Machine Learning", "Deep Learning", "NLP", "Computer Vision", "TensorFlow", "PyTorch", 
        "Scikit-learn", "Pandas", "NumPy", "Matplotlib", "Seaborn", "Jupyter", "Keras",
        "OpenCV", "NLTK", "spaCy", "Transformers", "BERT", "GPT", "LangChain", "Hugging Face",
        
        # Mobile Development
        "Android", "iOS", "React Native", "Flutter", "Xamarin", "Unity", "AR", "VR", "ARKit", "ARCore",
        
        # Fundamentals & Concepts
        "Data Structures", "Algorithms", "OOP", "DBMS", "Operating Systems", "Computer Networks",
        "System Design", "Software Engineering", "Agile", "Scrum", "Design Patterns", "SOLID",
        
        # Other Technologies
        "REST API", "GraphQL", "Microservices", "WebSocket", "OAuth", "JWT", "Blockchain",
        "Socket.io", "Apache Kafka", "RabbitMQ", "MQTT", "Nginx", "Apache", "Redis"
    ]

    found_skills = set()
    for skill in skill_keywords:
        # Use word boundaries for exact matching
        pattern = rf'\b{re.escape(skill)}\b'
        if re.search(pattern, resume_text, re.IGNORECASE):
            found_skills.add(skill)

    # Extract additional technical terms from project descriptions
    project_tech_pattern = r'\b(?:using|with|in|built|developed|implemented|created|designed)\s+([A-Z][A-Za-z0-9.+#-]+)\b'
    tech_matches = re.findall(project_tech_pattern, resume_text, re.IGNORECASE)
    
    for tech in tech_matches:
        if tech.lower() not in [s.lower() for s in found_skills] and len(tech) > 2:
            # Validate if it's likely a technology (contains common tech suffixes/patterns)
            if any(pattern in tech.lower() for pattern in ['.js', 'sql', 'db', 'api', 'ml', 'ai', 'ar', 'vr']):
                found_skills.add(tech)

    return list(found_skills), resume_text


def build_resume_only_questions(
    resume_text: str,
    skills: List[str],
    focus_analysis: Dict[str, str],
    session: InterviewSession
) -> List[Dict]:
    """Generate deterministic resume-only questions when LLM is unavailable."""
    domain = focus_analysis.get("primary_domain") or "General"
    projects = focus_analysis.get("key_projects", [])

    def s(idx: int, default: str) -> str:
        return skills[idx] if idx < len(skills) else default

    project_hint = projects[0] if projects else "a recent project from your resume"
    skill1, skill2, skill3 = s(0, "core domain fundamentals"), s(1, "tools"), s(2, "analysis")

    skill_lc = [sk.lower() for sk in skills]
    coding_langs = ["python", "java", "c++", "c", "javascript", "typescript", "matlab", "r", "go", "rust", "c#", "kotlin", "swift", "sql", "html"]
    primary_lang = None
    for lang in coding_langs:
        if lang in skill_lc:
            primary_lang = lang.title() if lang != "c++" else "C++"
            break
    if not primary_lang:
        primary_lang = "Python" if not domain.startswith("Mechanical") else "MATLAB"

    coding_skills = [sk for sk in skills if sk.lower() in {"python", "java", "javascript", "typescript", "c++", "c", "c#", "go", "rust", "kotlin", "swift", "matlab", "r", "sql", "html"}]

    non_cs_domains = {
        "Mechanical Engineering",
        "Civil Engineering",
        "Electrical Engineering",
        "Chemical Engineering",
        "Manufacturing/Production",
        "Aerospace Engineering",
        "Industrial Engineering",
    }

    is_non_cs = domain in non_cs_domains

    # Section generators
    easy_medium = [
        {
            "id": f"{session.session_id}_em_1",
            "q": f"Walk me through {project_hint}. What was your role, and how did you apply {skill1}?",
            "a": "Explain objectives, your contribution, and how the listed skill was applied to meet requirements.",
            "difficulty": "Easy",
            "topic": skill1,
        },
        {
            "id": f"{session.session_id}_em_2",
            "q": f"Which tools or methods did you use (e.g., {skill2}) and why were they appropriate?",
            "a": "Discuss tool selection criteria, constraints, and the impact on outcomes.",
            "difficulty": "Medium",
            "topic": skill2,
        },
    ]

    hard = [
        {
            "id": f"{session.session_id}_h_1",
            "q": f"If you had to improve the performance or reliability of {project_hint}, what would you change first and why?",
            "a": "Propose one high-impact change, justify with constraints and expected outcomes.",
            "difficulty": "Hard",
            "topic": skill1,
        },
    ]

    # Domain-aware analytical questions
    if is_non_cs:
        dsa = [
            {
                "id": f"{session.session_id}_dsa_1",
                "q": f"Write a {primary_lang} function to compute a safety factor given load, area, and yield strength from your domain context.",
                "a": "Use safety_factor = (yield_strength * area) / load; validate against edge cases.",
                "difficulty": "Medium",
                "examples": "Example: load=12000, area=30, yield_strength=300 => safety_factor=0.75",
                "constraints": "All inputs are positive; return a float with 2 decimals.",
                "complexity": "Time: O(1), Space: O(1)",
                "code": f"def safety_factor(load, area, yield_strength):\n    return round((yield_strength * area) / load, 2)\n",
                "topic": skill1,
            },
        ]
    else:
        dsa = [
            {
                "id": f"{session.session_id}_d_1",
                "q": f"Given a scenario involving {project_hint}, design an algorithm to optimize resource usage.",
                "a": "Describe the approach, data structures, and complexity.",
                "difficulty": "Medium",
                "examples": f"Input: A list of tasks related to {project_hint}. Output: Ordered list minimizing idle time.",
                "constraints": "Assume n tasks where n <= 10^5.",
                "complexity": "Expected: O(n log n) or better.",
                "code": "",
                "topic": "DSA",
            },
        ]

    behavioral = [
        {
            "id": f"{session.session_id}_b_1",
            "q": f"Tell me about a time you faced a major challenge in {project_hint}. How did you resolve it?",
            "a": "Describe the situation, actions you took, and the outcome.",
            "difficulty": "Easy",
            "topic": skill1,
        },
        {
            "id": f"{session.session_id}_b_2",
            "q": "Give an example where you had to make a decision with incomplete data.",
            "a": "Explain your reasoning, risk assessment, and result.",
            "difficulty": "Medium",
            "topic": skill3,
        },
    ]


    return [
        {"title": "Easy/Medium", "questions": easy_medium},
        {"title": "Hard", "questions": hard},
        {"title": "DSA", "questions": dsa},
        {"title": "Behavioral", "questions": behavioral},
    ]

# --- Dynamic Query Generation ---
def generate_varied_queries(skills: List[str], session: InterviewSession) -> List[str]:
    """Generate multiple varied queries for different perspectives"""
    
    # Base query components
    dsa_terms = [
        "data structures algorithms",
        "arrays strings trees graphs", 
        "sorting searching dynamic programming",
        "recursion backtracking greedy",
        "linked lists stacks queues",
        "binary trees graph traversal"
    ]
    
    tech_terms = [
        " ".join(skills[:3]),
        " ".join(skills[2:5]) if len(skills) > 2 else " ".join(skills),
        " ".join(skills[4:7]) if len(skills) > 4 else " ".join(skills[:2]),
    ]
    
    interview_contexts = [
        "coding interview questions",
        "technical interview problems", 
        "programming challenges",
        "software engineering questions",
        "computer science fundamentals"
    ]
    
    # Generate multiple query variations
    queries = []
    
    # DSA-focused queries
    for dsa in random.sample(dsa_terms, min(2, len(dsa_terms))):
        for context in random.sample(interview_contexts, 2):
            queries.append(f"{dsa} {context}")
    
    # Skill-based queries  
    for tech in tech_terms:
        if tech.strip():
            for context in random.sample(interview_contexts, 2):
                queries.append(f"{tech} {context}")
    
    # Mixed queries
    if skills:
        tech_sample = random.choice(tech_terms)
        dsa_sample = random.choice(dsa_terms)
        queries.append(f"{tech_sample} {dsa_sample} interview")
    
    return queries

# --- Enhanced Context Retrieval with Diversity ---
def get_diverse_context(skills: List[str], collection, session: InterviewSession) -> Dict[str, List[Dict]]:
    """Retrieve diverse contexts with session-based variation"""
    category_weights = session.get_rotation_weights()
    final_contexts = {}

    # If collection is None (DB not connected), return empty contexts
    if collection is None:
        for category in category_weights:
            final_contexts[category] = []
        return final_contexts

    # Map our categories to simple Mongo filters
    for category, target_count in category_weights.items():
        if category == "dsa":
            match_filter = {"category": "DSA"}
        elif category == "easy_medium":
            match_filter = {"difficulty": {"$in": ["Easy", "Medium"]}, "category": {"$ne": "DSA"}}
        elif category == "hard":
            match_filter = {"difficulty": "Hard", "category": {"$ne": "DSA"}}
        elif category == "behavioral":
            match_filter = {"$or": [{"type": "conceptual"}, {"category": {"$in": ["Behavioral", "System Design", "General"]}}]}
        else:
            match_filter = {}

        try:
            # Use aggregation with $match + $sample for random selection from DB
            sample_size = max(target_count * 3, target_count)
            pipeline = [{"$match": match_filter}, {"$sample": {"size": sample_size}}]
            items = list(collection.aggregate(pipeline))

            # Filter out already-used questions for this session
            selected = []
            for item in items:
                qid = str(item.get("id") or item.get("_id"))
                if qid in session.used_questions:
                    continue
                session.used_questions.add(qid)
                selected.append(item)
                if len(selected) >= target_count:
                    break

            # If we couldn't fill target_count, do a fallback small sample without filters
            if len(selected) < target_count:
                try:
                    extra_pipeline = [{"$sample": {"size": target_count - len(selected)}}]
                    extras = [e for e in collection.aggregate(extra_pipeline) if str(e.get("id") or e.get("_id")) not in session.used_questions]
                    for e in extras:
                        session.used_questions.add(str(e.get("id") or e.get("_id")))
                        selected.append(e)
                        if len(selected) >= target_count:
                            break
                except Exception:
                    pass

            final_contexts[category] = selected
        except Exception as e:
            print(f"[get_diverse_context] DB query failed for {category}: {e}")
            final_contexts[category] = []

    return final_contexts

# --- Enhanced Resume Analysis (same as before) ---
def analyze_resume_focus(resume_text: str, skills: List[str]) -> Dict[str, str]:
    """Analyze resume to determine candidate's focus areas"""
    focus_analysis = {
        "experience_level": "Entry" if any(word in resume_text.lower() for word in ["student", "intern", "fresh", "graduate"]) else "Experienced",
        "primary_domain": "",
        "key_projects": [],
        "strengths": []
    }
    
    # Determine primary domain
    domain_keywords = {
        "Web Development": ["react", "node.js", "javascript", "html", "css", "web", "frontend", "backend"],
        "Data Science/ML": ["machine learning", "deep learning", "tensorflow", "pytorch", "data", "ml", "ai"],
        "Mobile Development": ["android", "ios", "mobile", "app", "react native", "flutter"],
        "Systems/Backend": ["system design", "microservices", "api", "database", "server", "cloud"],
        "Game Development": ["unity", "game", "ar", "vr", "3d"],
        "Mechanical Engineering": ["mechanical", "cad", "solidworks", "autocad", "ansys", "thermodynamics", "fluid", "mechanics", "hvac", "manufacturing", "machining"],
        "Civil Engineering": ["civil", "structural", "concrete", "steel", "autocad", "staad", "survey", "construction", "geotechnical"],
        "Electrical Engineering": ["electrical", "circuit", "pcb", "power", "electronics", "matlab", "simulink", "vlsi", "embedded"],
        "Chemical Engineering": ["chemical", "process", "reactor", "thermodynamics", "mass transfer", "distillation", "aspentech"],
        "Manufacturing/Production": ["manufacturing", "production", "quality", "lean", "six sigma", "supply chain", "cnc"],
        "Aerospace Engineering": ["aerospace", "aerodynamics", "propulsion", "flight", "avionics"],
        "Industrial Engineering": ["industrial", "operations", "optimization", "logistics", "process improvement"]
    }
    
    max_matches = 0
    for domain, keywords in domain_keywords.items():
        matches = sum(1 for keyword in keywords if keyword.lower() in resume_text.lower())
        if matches > max_matches:
            max_matches = matches
            focus_analysis["primary_domain"] = domain

    if not focus_analysis["primary_domain"]:
        focus_analysis["primary_domain"] = "General"

    # Extract key projects
    project_lines = []
    lines = resume_text.split('\n')
    for i, line in enumerate(lines):
        if re.search(r'\b(project|built|developed|created|implemented|designed)\b', line.lower()):
            context = ' '.join(lines[i:i+2]).strip()
            if len(context) > 20:
                project_lines.append(context[:150] + "..." if len(context) > 150 else context)
    
    focus_analysis["key_projects"] = project_lines[:3]
    focus_analysis["strengths"] = skills[:6]

    return focus_analysis

# --- Dynamic Prompt Generation ---
def generate_dynamic_prompt(resume_text: str, skills: List[str], contexts: Dict[str, List[Dict]], 
                           focus_analysis: Dict[str, str], session: InterviewSession) -> str:
    """Generate varied prompts based on session with unique real-world scenarios"""
    
    # Different interviewer personas for variety
    interviewer_personas = [
        "senior_technical_architect",
        "startup_cto", 
        "enterprise_team_lead",
        "product_engineering_manager",
        "principal_engineer",
        "tech_consultant"
    ]
    
    persona = interviewer_personas[int(session.session_id, 16) % len(interviewer_personas)]
    
    # Simple enhancement helpers based on candidate's domain
    def get_context_enhancement_hints(domain: str, skills: List[str]) -> Dict[str, str]:
        """Provide subtle enhancement hints without overcomplicating"""
        return {
            "projects_focus": "project experience, system design, technical architecture, and scaling challenges",
            "dsa_focus": "clean algorithmic problems with proper formatting - examples and explanations on new lines", 
            "behavioral_focus": "workplace scenarios, teamwork, leadership, and decision-making situations"
        }

    # Keep original context formatting but enhance it slightly
    def format_context(context_list: List[Dict], section_name: str) -> str:
        if not context_list:
            return f"\n{section_name.upper()} CONTEXT: No specific context found.\n"
        
        formatted = f"\n{section_name.upper()} CONTEXT:\n"
        for i, ctx in enumerate(context_list[:4], 1):  # Show more examples for variety
            formatted += f"{i}. Topic: {ctx.get('topic', 'N/A')} | Category: {ctx.get('category', 'N/A')}\n"
            if ctx.get('question'):
                formatted += f"   Example Q: {ctx['question'][:120]}...\n"
            if ctx.get('answer'):
                formatted += f"   Key Concept: {ctx['answer'][:180]}...\n"
        return formatted + "\n"

    # Only use resume content for question generation
    context_section = "\nNO EXTERNAL CONTEXTS: Generate questions only from the resume text and extracted skills.\n"

    # Get enhancement hints
    enhancement_hints = get_context_enhancement_hints(focus_analysis['primary_domain'], skills)
    
    # Persona-specific interview approaches
    persona_approaches = {
        "senior_technical_architect": "Focus on system design, scalability, and architectural trade-offs with real production scenarios.",
        "startup_cto": "Emphasize rapid prototyping, resource constraints, and building scalable solutions from scratch.", 
        "enterprise_team_lead": "Highlight team collaboration, code reviews, mentoring, and enterprise-scale challenges.",
        "product_engineering_manager": "Balance technical depth with product thinking and cross-functional collaboration.",
        "principal_engineer": "Deep dive into complex technical problems, performance optimization, and technical leadership.",
        "tech_consultant": "Focus on problem-solving methodology, client communication, and diverse technology stacks."
    }

    # Default style for prompt formatting (readable) and grounding scenarios
    style = persona

    non_cs_domains = {
        "Mechanical Engineering",
        "Civil Engineering",
        "Electrical Engineering",
        "Chemical Engineering",
        "Manufacturing/Production",
        "Aerospace Engineering",
        "Industrial Engineering",
    }
    is_non_cs = focus_analysis.get("primary_domain") in non_cs_domains
    non_cs_instruction = ""
    if is_non_cs:
        non_cs_instruction = (
            "\nIMPORTANT: The candidate is NOT in software/CS. "
            "Avoid software engineering and algorithmic/DSA topics. "
            "Use domain-specific technical questions grounded in the resume. "
            "For the 'dsa' section, provide analytical problem-solving questions "
            "relevant to the domain (design constraints, calculations, trade-offs, "
            "process optimization), not coding puzzles.\n"
        )

    # Provide grounding scenarios for the prompt. Prefer candidate projects if present.
    scenario_contexts = {
        "scenarios": [
            (focus_analysis.get('key_projects', []) and focus_analysis['key_projects'][0][:140]) or "candidate project and feature work",
            "scaling / performance incident in production",
            "designing and launching a new feature end-to-end"
        ]
    }

    # Keep original JSON schema but enhance question requirements
    json_schema_instructions = f"""
Return a single JSON object only (no surrounding commentary). The JSON MUST match this schema exactly:

{{
    "metadata": {{
        "experience_level": string,
        "primary_domain": string, 
        "skills": [string],
        "key_projects": [string]
    }},
    "easy_medium": [
        {{"q": string, "a": string}},  // exactly 2 items
    ],
    "hard": [
        {{"q": string, "a": string}},  // exactly 1 item
    ],
    "dsa": [
        {{"difficulty": "Medium"|"Hard", "q": string, "a": string, "examples": string, "constraints": string, "complexity": string, "code": string}},  // exactly 1 item
    ],
    "behavioral": [
        {{"q": string, "a": string}},  // exactly 2 items
    ]
}}

ENHANCED REQUIREMENTS:
- Output must be valid JSON parseable by json.loads()
- Use the exact keys shown above.
- Keep code blocks and examples as strings.

QUESTION DISTRIBUTION:
- easy_medium: 2 questions (1 Project + 1 Technical)
- hard: 1 advanced technical question
- dsa: 1 Medium difficulty problem with examples/constraints
- behavioral: 2 questions (1 Scenario + 1 Collaboration)

All questions must be grounded in these scenarios: {', '.join(scenario_contexts['scenarios'][:3])}
- Focus approach: {persona_approaches[persona]}
"""

    prompt = f"""
You are a {style.replace('_', ' ')} conducting a technical interview. Generate UNIQUE and VARIED interview questions and answers based on the provided context and candidate profile.

SESSION ID: {session.session_id} (Use this to ensure question variety across sessions)

=== CANDIDATE ANALYSIS ===
Experience Level: {focus_analysis['experience_level']}
Primary Domain: {focus_analysis['primary_domain']}
Key Technical Skills: {', '.join(skills[:10])}
Key Projects: {'; '.join(focus_analysis['key_projects'])}

=== TECHNICAL CONTEXTS ===
{context_section}

=== RESUME SUMMARY (Key Sections) ===
{resume_text[:2000]}...

QUESTION GENERATION GUIDELINES:
1. **Primary Source**: Use ONLY the resume text and extracted skills below
2. **No External Knowledge**: Do NOT introduce questions from unrelated domains
3. **Uniqueness**: Make them specific to the candidate's background
4. **Balance**: Mix project, technical, and scenario questions grounded in resume
5. **Appropriate Difficulty**: Match the candidate's experience level
{non_cs_instruction}

INTERVIEW STRUCTURE - QUICK START:

SECTION 1 - TECHNICAL CORE (easy_medium + hard):
- easy_medium: 2 questions (1 Project-based, 1 Technical concept)
- hard: 1 advanced technical question

SECTION 2 - PROBLEM SOLVING (dsa):
- 1 algorithmic/analytical question (Medium difficulty)
- Include clean problem statement and complexity

SECTION 3 - BEHAVIORAL:
- 2 behavioral questions about teamwork and challenges

Generate interview content STRICTLY as JSON following the schema below:
{json_schema_instructions}
"""
    
    return prompt


# --- Main Enhanced Pipeline ---
def interview_rag_pipeline(resume_pdf_path: str, collection):
    """Enhanced interview question generation pipeline with variety"""
    # print("🚀 Starting Enhanced Interview RAG Pipeline with Question Variety...")
    
    # Create new session for this run
    session = InterviewSession(resume_pdf_path)
    
    # Step 1: Extract skills and analyze resume
    # print("📄 Analyzing resume...")
    skills, resume_text = extract_skills_from_resume(resume_pdf_path)
    # print(f"✅ Extracted {len(skills)} technical skills: {skills[:10]}...")
    
    # Step 2: Analyze resume focus  
    focus_analysis = analyze_resume_focus(resume_text, skills)
    # print(f"🎯 Candidate Focus: {focus_analysis['primary_domain']} ({focus_analysis['experience_level']} level)")
    
    # Step 3: Retrieve diverse contexts
    # print("🔍 Retrieving diverse technical contexts...")
    contexts = get_diverse_context(skills, collection, session)

    non_cs_domains = {
        "Mechanical Engineering",
        "Civil Engineering",
        "Electrical Engineering",
        "Chemical Engineering",
        "Manufacturing/Production",
        "Aerospace Engineering",
        "Industrial Engineering",
    }

    if focus_analysis.get("primary_domain") in non_cs_domains:
        contexts = {"easy_medium": [], "hard": [], "dsa": [], "behavioral": []}

    total_contexts = sum(len(ctx_list) for ctx_list in contexts.values())
    # print(f"✅ Retrieved {total_contexts} diverse contexts across all categories")
    
    # Step 4: Generate dynamic prompt
    # print("📝 Generating varied interview questions...")
    prompt = generate_dynamic_prompt(resume_text, skills, contexts, focus_analysis, session)
    
    # Step 5: Call LLM with dynamic prompt (multi-provider fallback)
    llm_text = None  # Initialize to avoid unbound variable error
    try:
        llm_text = call_llm_with_fallback(prompt)

        # print(f"\n🎯 Session {session.session_id} - Interview Questions Generated")
        # print("="*60)
        # print("🎤 RAW LLM OUTPUT")
        # print("="*60)
        # print(llm_text)
        # print("="*60)

        # --- Pydantic models for validation ---
        class QAItem(BaseModel):
            q: str
            a: str
            id: Optional[str] = None
            difficulty: Optional[str] = None
            code: Optional[str] = None

        class DSAItem(QAItem):
            difficulty: Optional[str] = 'Medium'  # Override with same type as parent
            complexity: str = ""
            examples: str = ""
            constraints: str = ""

        class Metadata(BaseModel):
            experience_level: str
            primary_domain: str
            skills: List[str]
            key_projects: List[str]

        class LLMOutput(BaseModel):
            metadata: Metadata
            easy_medium: List[QAItem] = Field(min_length=2, max_length=5)
            hard: List[QAItem] = Field(min_length=1, max_length=4)
            dsa: List[DSAItem] = Field(min_length=1, max_length=4)
            behavioral: List[QAItem] = Field(min_length=2, max_length=4)

        # Try robust extraction of JSON-like content
        def extract_json_from_text(s: str):
            try:
                return json.loads(s)
            except Exception:
                pass

            import re
            # try fenced json
            m = re.search(r"```json\s*(\{.*?\})\s*```", s, flags=re.S)
            if m:
                try:
                    return json.loads(m.group(1))
                except Exception:
                    pass

            # try to find first balanced JSON object
            start = s.find('{')
            if start == -1:
                return None
            # crude but often effective: find last '}'
            end = s.rfind('}')
            if end == -1 or end <= start:
                return None
            candidate = s[start:end+1]
            try:
                return json.loads(candidate)
            except Exception:
                return None

        parsed_json = extract_json_from_text(llm_text if isinstance(llm_text, str) else str(llm_text))
        # print(f"🔍 Extracted JSON keys: {list(parsed_json.keys()) if parsed_json else 'None'}")
        if parsed_json and 'dsa' in parsed_json:
            dsa_sample = parsed_json['dsa'][0] if parsed_json['dsa'] else {}
            # print(f"🔍 First DSA item keys: {list(dsa_sample.keys())}")
        parsed_valid = None
        if parsed_json is None:
            pass
            print("⚠️ Failed to extract JSON from LLM output. Will fallback to building sections from retrieved contexts.")
        else:
            # Add missing DSA fields before validation
            if 'dsa' in parsed_json:
                for item in parsed_json['dsa']:
                    if 'examples' not in item:
                        item['examples'] = "Example:\nInput: [sample input]\nOutput: [sample output]"
                    if 'constraints' not in item:
                        item['constraints'] = "1 <= n <= 10^5\nTime limit: 1 second"
                    if 'complexity' not in item:
                        item['complexity'] = "Time: O(n), Space: O(1)"
            
            # Validate with pydantic
            try:
                parsed_valid = LLMOutput.parse_obj(parsed_json)
                # print("✅ LLM output validated by Pydantic")
            except ValidationError as ve:
                print("❌ Pydantic validation failed:")
                print(ve.json())
                parsed_valid = None

        # Build final response from validated model or fallback to contexts
        final_sections = []

        if parsed_valid is not None:
            # convert pydantic model into sections
            def mk_section(title: str, items):
                questions = []
                for i, it in enumerate(items, 1):
                    qid = it.id or f"{session.session_id}_{title.replace('/','_').replace(' ','_').lower()}_q{i}"
                    item_obj = {
                        "id": qid,
                        "q": it.q,
                        "a": it.a,
                    }

                    # Common optional fields
                    if getattr(it, 'difficulty', None):
                        item_obj['difficulty'] = getattr(it, 'difficulty')
                    if getattr(it, 'code', None):
                        item_obj['code'] = getattr(it, 'code')

                    # DSA-specific extras
                    if hasattr(it, 'complexity') and getattr(it, 'complexity', None):
                        item_obj['complexity'] = getattr(it, 'complexity')
                    if hasattr(it, 'examples') and getattr(it, 'examples', None):
                        item_obj['examples'] = getattr(it, 'examples')
                    if hasattr(it, 'constraints') and getattr(it, 'constraints', None):
                        item_obj['constraints'] = getattr(it, 'constraints')

                    questions.append(item_obj)

                return {"title": title, "questions": questions}

            final_sections.append(mk_section('Easy/Medium', parsed_valid.easy_medium))
            final_sections.append(mk_section('Hard', parsed_valid.hard))
            final_sections.append(mk_section('DSA', parsed_valid.dsa))
            final_sections.append(mk_section('Behavioral', parsed_valid.behavioral))

        else:
            # fallback: build sections from contexts dict
            qid = 1
            ctx_map = [
                ("Easy/Medium", contexts.get('easy_medium', [])),
                ("Hard", contexts.get('hard', [])),
                ("DSA", contexts.get('dsa', [])),
                ("Behavioral", contexts.get('behavioral', []))
            ]
            for title, items in ctx_map:
                questions = []
                for item in items[:3]:
                    q_text = item.get('question') or item.get('q') or item.get('prompt') or ''
                    a_text = item.get('answer') or item.get('a') or ''
                    diff = item.get('difficulty') or item.get('complexity')
                    code = item.get('code') if isinstance(item.get('code'), str) else None
                    complexity = item.get('complexity')
                    examples = item.get('examples') or item.get('example') or None
                    constraints = item.get('constraints') or item.get('constraint') or None

                    qobj = {
                        "id": f"{session.session_id}_q{qid}",
                        "q": q_text,
                        "a": a_text,
                    }
                    if diff:
                        qobj['difficulty'] = diff
                    if code:
                        qobj['code'] = code
                    if complexity:
                        qobj['complexity'] = complexity
                    if examples:
                        qobj['examples'] = examples
                    if constraints:
                        qobj['constraints'] = constraints
                    
                    # For DSA sections, ensure examples and constraints are present
                    if title == "DSA":
                        if not examples:
                            qobj['examples'] = "Example: Input: [sample input]\nOutput: [expected output]\nExplanation: [brief explanation]"
                        if not constraints:
                            qobj['constraints'] = "1 <= n <= 10^4\n1 <= values <= 10^9"

                    questions.append(qobj)
                    qid += 1
                final_sections.append({"title": title, "questions": questions})

        final_response = {
            "status": "success", 
            "sections": final_sections,
            "session_id": session.session_id
        }
        
    except Exception as e:
        print(f"❌ Error calling LLM: {e}")
        fallback_sections = build_resume_only_questions(resume_text, skills, focus_analysis, session)
        final_response = {
            "status": "fallback",
            "sections": fallback_sections,
            "session_id": session.session_id,
            "error_message": str(e),
            "questionsSource": "resume-fallback"
        }

    # Return the structured final response and include diagnostics
    # Custom set assembly removed — keep the original `final_response['sections']` as built above.

    final_response.update({
        "skills": skills,
        "focus_analysis": focus_analysis,
        "contexts_retrieved": total_contexts,
        "llm_output": llm_text
    })

    return final_response

# --- Run Enhanced Pipeline ---
if __name__ == "__main__":
    load_dotenv()
    
    # Update your resume path
    resume_pdf_path = "/Users/vishnuvardhan/Downloads/Main_resume_mvv.pdf"
    
    try:
        result = interview_rag_pipeline(resume_pdf_path, collection)
        print(f"\n✅ Pipeline completed successfully!")
        print(f"📊 Session: {result.get('session_id', 'Unknown')}")
        print(f"📊 Summary: {len(result['skills'])} skills, {result['contexts_retrieved']} contexts retrieved")
        print(f"🎯 Sections generated: {len(result['sections'])}")
    except Exception as e:
        print(f"❌ Pipeline failed: {e}")
        pass