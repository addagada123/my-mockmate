from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from datetime import timedelta
from backend.auth.models import User, Token
from backend.auth.utils import (
    verify_password,
    get_password_hash,
    create_access_token,
    ACCESS_TOKEN_EXPIRE_MINUTES
)
from backend.db.mongo import get_db
from pydantic import BaseModel, EmailStr
from datetime import datetime
import logging
import asyncio

logger = logging.getLogger(__name__)
router = APIRouter()

class UserRegister(BaseModel):
    username: str
    email: EmailStr
    password: str
    full_name: str = ""

@router.post("/register", response_model=Token)
async def register(user: UserRegister):
    """Register new user"""
    db = get_db()

    # Basic password validation
    if not user.password or len(user.password) < 8:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must be at least 8 characters long"
        )
    if len(user.password) > 128:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must be at most 128 characters long"
        )
    
    # Check if user exists
    if db.users.find_one({"username": user.username}):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered"
        )
    
    if db.users.find_one({"email": user.email}):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
        # Create user
    user_dict = {
        "username": user.username,
        "email": user.email,
        "full_name": user.full_name,
        "hashed_password": get_password_hash(user.password),
        "disabled": False,
        "created_at": datetime.now()
    }
    
    result = db.users.insert_one(user_dict)
    user_id = str(result.inserted_id)
    
    # Create access token
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username, "user_id": user_id, "email": user.email},
        expires_delta=access_token_expires
    )
    
    return {"access_token": access_token, "token_type": "bearer"}

@router.post("/login", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    """Login user"""
    db = get_db()
    
    # Find user
    user = db.users.find_one({"username": form_data.username})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Check if hashed_password exists
    if "hashed_password" not in user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account missing password. Please re-register.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not verify_password(form_data.password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Create access token
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={
            "sub": user.get("username") or user.get("email"),
            "user_id": str(user["_id"]),
            "email": user.get("email")
        },
        expires_delta=access_token_expires
    )
    
    return {"access_token": access_token, "token_type": "bearer"}

class SignInRequest(BaseModel):
    email: str
    password: str

@router.post("/signin", response_model=Token)
async def signin(request: SignInRequest):
    """Sign in user (alias for login, accepts email instead of username)"""
    logger.info(f"Sign in attempt with email: {request.email}")
    
    try:
        db = get_db()
        logger.info("Database connection established")
        
        # Find user by email
        logger.info("Searching for user in database...")
        user = db.users.find_one({"email": request.email})
        
        if not user:
            logger.warning(f"User not found with email: {request.email}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect email or password",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        logger.info("User found, verifying password...")
        # Check if hashed_password exists in user document
        if "hashed_password" not in user:
            logger.error(f"User document missing hashed_password field for: {request.email}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Account missing password. Please re-register.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        if not verify_password(request.password, user["hashed_password"]):
            logger.warning(f"Password verification failed for: {request.email}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect email or password",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        logger.info("Password verified, creating token...")
        # Create access token
        access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = create_access_token(
            data={
                "sub": user.get("username") or user.get("email"),
                "user_id": str(user["_id"]),
                "email": user.get("email")
            },
            expires_delta=access_token_expires
        )
        
        logger.info(f"Sign in successful for: {request.email}")
        return {"access_token": access_token, "token_type": "bearer"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Sign in error: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error during sign in"
        )
