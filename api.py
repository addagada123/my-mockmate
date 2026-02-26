# -------------------- IMPORTS --------------------
from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from pydantic import BaseModel, Field
from typing import List, Optional

import asyncio
import uuid
import shutil
import os
from datetime import datetime

from dotenv import load_dotenv
from jose import jwt, JWTError

# -------------------- ENV --------------------
load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY", "supersecret")
ALGORITHM = "HS256"

# -------------------- APP --------------------
app = FastAPI()

# -------------------- CORS --------------------
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------- AUTH --------------------
security = HTTPBearer()

def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    try:
        payload = jwt.decode(
            credentials.credentials,
            SECRET_KEY,
            algorithms=[ALGORITHM],
        )
        return payload["sub"]
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

# -------------------- STORAGE --------------------
UPLOAD_DIR = "./uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

WORKER_COUNT = int(os.getenv("WORKER_COUNT", "6"))
semaphore = asyncio.BoundedSemaphore(WORKER_COUNT)

# -------------------- MODELS --------------------
class Question(BaseModel):
    id: str
    question: str
    answer: Optional[str] = ""

class Section(BaseModel):
    title: str
    questions: List[Question]

class Original(BaseModel):
    sections: List[Section]

class StudentQuestion(BaseModel):
    questionId: str
    questionText: str
    referenceAnswer: str
    studentAnswer: Optional[str] = None

class EvaluationRequest(BaseModel):
    original: Original
    questions: List[StudentQuestion]

class QuestionEvaluation(BaseModel):
    id: str
    question: str
    referenceAnswer: Optional[str] = ""
    score: int = Field(..., description="Score 0–100")
    confidence: Optional[float] = None
    feedback: str
    suggestions: List[str]

class SectionEvaluation(BaseModel):
    title: str
    score: int
    improvements: str
    suggestions: List[str]
    questions: List[QuestionEvaluation]

class EvaluationResponse(BaseModel):
    overallScore: int
    evaluatedAt: str
    sections: List[SectionEvaluation]

class LLMEvaluationResult(BaseModel):
    overallScore: int
    sections: List[SectionEvaluation]

# -------------------- ROUTES --------------------

@app.post("/generate")
async def generate_questions(
    resume: UploadFile = File(...),
    user: str = Depends(get_current_user),  # 🔒 PROTECTED
):
    if resume.content_type != "application/pdf":
        raise HTTPException(400, "Only PDF supported")

    filename = f"{uuid.uuid4().hex}_{resume.filename}"
    file_path = os.path.join(UPLOAD_DIR, filename)

    with open(file_path, "wb") as f:
        shutil.copyfileobj(resume.file, f)

    try:
        from endeavor_rag_service import interview_rag_pipeline, collection

        await semaphore.acquire()
        try:
            result = await asyncio.to_thread(
                interview_rag_pipeline, file_path, collection
            )
        finally:
            semaphore.release()

        return result

    finally:
        if os.path.exists(file_path):
            os.remove(file_path)

@app.get("/health")
async def health():
    return {"ok": True}

# -------------------- RUN --------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
