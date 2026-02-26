from fastapi import FastAPI, File, UploadFile, HTTPException, Depends, status, Response, BackgroundTasks
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import os
from datetime import datetime, timedelta
import shutil
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

def _get_top_topics(questions: List[Dict[str, Any]], fallback: List[str], limit: int = 5) -> List[str]:
    # 1. Collect topics from questions
    topic_counts: Dict[str, int] = {}
    for q in questions:
        topic = (q.get("topic") or "").strip()
        if not topic:
            continue
        topic_counts[topic] = topic_counts.get(topic, 0) + 1

    # 2. Get sorted topics from questions
    sorted_topics = [t[0] for t in sorted(topic_counts.items(), key=lambda item: item[1], reverse=True)]
    
    # 3. Add fallback topics (skills) if we need more to reach limit
    # Filter out duplicates (case-insensitive)
    existing_topics_lower = {t.lower() for t in sorted_topics}
    
    if fallback:
        for skill in fallback:
            if len(sorted_topics) >= limit:
                break
            if skill and skill.strip() and skill.lower() not in existing_topics_lower:
                sorted_topics.append(skill.strip())
                existing_topics_lower.add(skill.lower())

    # 4. If still empty, return fallback
    if not sorted_topics:
        return (fallback or [])[:limit]
        
    return sorted_topics[:limit]

def _difficulty_label(value: Optional[str]) -> str:
    if not value:
        return "Medium"
    v = value.strip().lower()
    if v == "easy":
        return "Easy"
    if v == "hard":
        return "Hard"
    return "Medium"

def _generate_topic_questions(
    topic: Optional[str],
    difficulty: Optional[str],
    count: int,
    existing_questions: set,
    session_id: Optional[str] = None
) -> List[Dict[str, Any]]:
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
            "Describe a mid-level challenge you faced in {topic} and how you solved it.",
            "How do you measure success or quality in {topic}?",
            "Explain trade-offs you considered when working on {topic}.",
            "Describe how you would improve a {topic} solution from your resume.",
        ],
        "hard": [
            "Design an end-to-end solution for a complex {topic} problem.",
            "Explain how you would scale or optimize a {topic} system.",
            "Describe a failure scenario in {topic} and how you would prevent it.",
            "Discuss advanced techniques or optimizations you would use in {topic}.",
            "Propose a migration or refactor plan for a {topic} project.",
        ],
    }

    if diff_key not in templates:
        diff_key = "medium"

    results: List[Dict[str, Any]] = []
    pool = templates[diff_key]
    attempts = 0
    index = 1
    while len(results) < count and attempts < len(pool) * 3:
        template = pool[attempts % len(pool)]
        question = template.format(topic=base_topic)
        q_key = question.strip().lower()
        attempts += 1
        if q_key in existing_questions:
            continue
        existing_questions.add(q_key)
        results.append({
            "id": f"{session_id or 'generated'}_{diff_key}_{index}",
            "question": question,
            "answer": f"Provide a clear explanation and relate it to your experience with {base_topic}.",
            "difficulty": diff_label,
            "topic": base_topic,
        })
        index += 1

    while len(results) < count:
        question = f"Explain an advanced aspect of {base_topic} (variant {index})."
        q_key = question.strip().lower()
        if q_key in existing_questions:
            index += 1
            continue
        existing_questions.add(q_key)
        results.append({
            "id": f"{session_id or 'generated'}_{diff_key}_{index}",
            "question": question,
            "answer": f"Describe the concept with examples relevant to {base_topic}.",
            "difficulty": diff_label,
            "topic": base_topic,
        })
        index += 1

    return results

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
    current_user: Dict = Depends(get_current_user)
):
    """
    Upload resume and generate interview questions
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
                        })

            if not questions:
                raise HTTPException(
                    status_code=500,
                    detail="Failed to generate questions from resume"
                )
            
            # Limit topics to top 4-5 for focused practice
            limited_topics = _get_top_topics(questions, result.get("skills", []), limit=5)

            # Create session in MongoDB
            db = get_db()
            session_data = {
                "user_id": current_user["id"],
                "username": current_user["username"],
                "resume_file": file.filename,
                "resume_path": file_path,
                "skills": limited_topics,
                "all_skills": result.get("skills", []),
                "experience": result.get("experience", ""),
                "questions": questions,
                "questionVersion": result.get("questionVersion", 3),
                "questionsSource": result.get("questionsSource", "resume-gemini-only"),
                "created_at": datetime.now(),
                "status": "in_progress"
            }
            
            session_result = db.user_sessions.insert_one(session_data)
            session_id = str(session_result.inserted_id)
            
            logger.info(f"Session created: {session_id} with {len(result.get('questions', []))} questions")
            
            return {
                "success": True,
                "session_id": session_id,
                "skills": limited_topics,
                "topicsDetected": limited_topics,
                "all_skills": result.get("skills", []),
                "experience": result.get("experience", ""),
                "questions": questions,
                "questionVersion": result.get("questionVersion", 3),
                "questionsSource": result.get("questionsSource", "resume-gemini-only"),
                "message": f"Generated {len(questions)} questions"
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

@app.get("/recommend-jobs")
async def recommend_jobs(
    current_user: Dict = Depends(get_current_user)
):
    """
    Recommend jobs based on user skills and performance
    """
    try:
        db = get_db()
        
        # Get user's latest session to extract skills
        latest_session = db.user_sessions.find_one(
            {"user_id": current_user["id"]},
            sort=[("created_at", -1)]
        )
        
        if not latest_session:
            # Check if there are ANY sessions, if not, return empty
            return {
                "success": False, 
                "jobs": [], 
                "user_skills": [],
                "message": "No resume uploaded yet"
            }
        
        user_skills = set(latest_session.get("skills") or [])
        
        # Mock job recommendations (in production, this would query a job database)
        all_jobs = [
            {
                "id": "job-1",
                "title": "Senior Python Developer",
                "company": "TechNova",
                "location": "Remote",
                "ctc_min": 1800000,
                "ctc_max": 2800000,
                "experience": "3-6 years",
                "description": "Looking for an experienced Python developer",
                "required_skills": ["Python", "Django", "REST API", "PostgreSQL"],
            },
            {
                "id": "job-2",
                "title": "Full Stack Developer",
                "company": "StackWorks",
                "location": "Bengaluru",
                "ctc_min": 1200000,
                "ctc_max": 2200000,
                "experience": "2-5 years",
                "description": "Full stack position with modern technologies",
                "required_skills": ["React", "Node.js", "MongoDB", "TypeScript"],
            },
            {
                "id": "job-3",
                "title": "Data Scientist",
                "company": "InsightLabs",
                "location": "Hyderabad",
                "ctc_min": 1500000,
                "ctc_max": 2600000,
                "experience": "2-4 years",
                "description": "Data science role with ML focus",
                "required_skills": ["Python", "Machine Learning", "Pandas", "TensorFlow"],
            },
            {
                "id": "job-4",
                "title": "DevOps Engineer",
                "company": "CloudScale",
                "location": "Pune",
                "ctc_min": 1400000,
                "ctc_max": 2400000,
                "experience": "3-5 years",
                "description": "DevOps position managing cloud infrastructure",
                "required_skills": ["AWS", "Docker", "Kubernetes", "CI/CD"],
            }
        ]
        
        # Calculate match scores
        recommendations = []
        for job in all_jobs:
            job_skills = set(job["required_skills"])
            matching_skills = user_skills.intersection(job_skills)
            missing_skills = job_skills.difference(user_skills)
            match_score = len(matching_skills) / len(job_skills) if job_skills else 0
            match_score_pct = round(match_score * 100, 2)
            match_level = 3 if match_score_pct >= 75 else 2 if match_score_pct >= 50 else 1

            recommendations.append({
                "id": job.get("id"),
                "title": job["title"],
                "company": job.get("company"),
                "location": job.get("location"),
                "ctc_min": job.get("ctc_min"),
                "ctc_max": job.get("ctc_max"),
                "experience": job.get("experience"),
                "description": job["description"],
                "match_score": match_level,
                "match_score_pct": match_score_pct,
                "required_skills": job["required_skills"],
                "matching_skills": list(matching_skills),
                "missing_skills": list(missing_skills)
            })
        
        # Sort by match score
        recommendations.sort(key=lambda x: x["match_score"], reverse=True)
        
        return {
            "success": True,
            "user_skills": list(user_skills),
            "jobs": recommendations[:5],
            "recommendations": recommendations[:5]
        }
        
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
