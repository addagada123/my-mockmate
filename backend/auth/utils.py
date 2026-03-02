import bcrypt
from jose import JWTError, jwt
from datetime import datetime, timedelta
from fastapi import Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from fastapi.security import OAuth2PasswordBearer
from typing import Optional, Dict
import os
from dotenv import load_dotenv

load_dotenv()

# Password hashing — use bcrypt directly (passlib is unmaintained and broken with bcrypt>=4)
_BCRYPT_ROUNDS = 10  # ~4x faster than default 12, still secure

# OAuth2 scheme
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")

# JWT settings
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-here-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

def _hash_pw(password: str) -> str:
    """Hash a password with bcrypt."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=_BCRYPT_ROUNDS)).decode("utf-8")

def _check_pw(password: str, hashed: str) -> bool:
    """Verify a password against its bcrypt hash.
    Also handles legacy passlib bcrypt_sha256 hashes ($bcrypt-sha256$...)
    by falling back to passlib if available.
    """
    try:
        if hashed.startswith("$bcrypt-sha256$"):
            # Legacy passlib format — try passlib if installed
            try:
                from passlib.context import CryptContext
                _legacy = CryptContext(schemes=["bcrypt_sha256"], deprecated="auto")
                return _legacy.verify(password, hashed)
            except Exception:
                return False
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False

def verify_password_sync(plain_password: str, hashed_password: str) -> bool:
    """Verify password against hash (sync — prefer async version)"""
    return _check_pw(plain_password, hashed_password)

async def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password against hash without blocking the event loop"""
    return await run_in_threadpool(_check_pw, plain_password, hashed_password)

def get_password_hash_sync(password: str) -> str:
    """Hash password (sync — prefer async version)"""
    return _hash_pw(password)

async def get_password_hash(password: str) -> str:
    """Hash password without blocking the event loop"""
    return await run_in_threadpool(_hash_pw, password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create JWT access token"""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(token: str = Depends(oauth2_scheme)) -> Dict:
    """Get current user from JWT token"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if username is None:
            raise credentials_exception
        return {
            "username": username,
            "id": payload.get("user_id"),
            "email": payload.get("email")
        }
    except JWTError:
        raise credentials_exception
