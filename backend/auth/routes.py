from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
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
import os
import httpx

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
    
    # Check if user exists (run sync PyMongo in threadpool)
    existing_user = await run_in_threadpool(db.users.find_one, {"username": user.username})
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered"
        )
    
    existing_email = await run_in_threadpool(db.users.find_one, {"email": user.email})
    if existing_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Create user (hash password off the event loop)
    user_dict = {
        "username": user.username,
        "email": user.email,
        "full_name": user.full_name,
        "hashed_password": await get_password_hash(user.password),
        "disabled": False,
        "created_at": datetime.now()
    }
    
    result = await run_in_threadpool(db.users.insert_one, user_dict)
    user_id = str(result.inserted_id)
    
    # Create access token
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username, "user_id": user_id, "email": user.email},
        expires_delta=access_token_expires
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "email": user.email,
        "full_name": user.full_name
    }

@router.post("/login", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    """Login user"""
    db = get_db()
    
    # Find user
    user = await run_in_threadpool(db.users.find_one, {"username": form_data.username})
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
    
    if not await verify_password(form_data.password, user["hashed_password"]):
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
        user = await run_in_threadpool(db.users.find_one, {"email": request.email})
        
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
        
        if not await verify_password(request.password, user["hashed_password"]):
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
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "email": user.get("email"),
            "full_name": user.get("full_name", "")
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Sign in error: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error during sign in"
        )


# ─── Google OAuth ───────────────────────────────────────────────

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")

class GoogleAuthRequest(BaseModel):
    credential: str  # Google ID token from frontend

@router.post("/google", response_model=Token)
async def google_auth(request: GoogleAuthRequest):
    """Authenticate via Google Sign-In (verify ID token, auto-register if new)"""
    try:
        # Verify the Google ID token using Google's tokeninfo endpoint
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"https://oauth2.googleapis.com/tokeninfo?id_token={request.credential}"
            )
        
        if resp.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid Google token"
            )
        
        payload = resp.json()
        
        # Verify audience matches our client ID (if configured)
        if GOOGLE_CLIENT_ID and payload.get("aud") != GOOGLE_CLIENT_ID:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token not intended for this application"
            )
        
        google_email = payload.get("email")
        if not google_email or payload.get("email_verified") != "true":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Google email not verified"
            )
        
        google_name = payload.get("name", "")
        google_picture = payload.get("picture", "")
        
        db = get_db()
        
        # Check if user already exists
        user = await run_in_threadpool(db.users.find_one, {"email": google_email})
        
        if not user:
            # Auto-register Google user
            username = google_email.split("@")[0]
            # Ensure unique username
            base_username = username
            counter = 1
            while await run_in_threadpool(db.users.find_one, {"username": username}):
                username = f"{base_username}{counter}"
                counter += 1
            
            user_dict = {
                "username": username,
                "email": google_email,
                "full_name": google_name,
                "picture": google_picture,
                "hashed_password": "",  # No password for Google users
                "auth_provider": "google",
                "disabled": False,
                "created_at": datetime.now()
            }
            result = await run_in_threadpool(db.users.insert_one, user_dict)
            user_id = str(result.inserted_id)
            logger.info(f"New Google user registered: {google_email}")
        else:
            user_id = str(user["_id"])
            username = user.get("username") or google_email.split("@")[0]
            # Update picture if changed
            if google_picture and user.get("picture") != google_picture:
                await run_in_threadpool(
                    db.users.update_one,
                    {"_id": user["_id"]},
                    {"$set": {"picture": google_picture}}
                )
            logger.info(f"Existing user signed in via Google: {google_email}")
        
        # Create JWT
        access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = create_access_token(
            data={
                "sub": username,
                "user_id": user_id,
                "email": google_email
            },
            expires_delta=access_token_expires
        )
        
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "email": google_email,
            "full_name": google_name
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Google auth error: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google authentication failed"
        )
