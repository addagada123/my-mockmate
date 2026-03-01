from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime

class User(BaseModel):
    """User model"""
    username: str
    email: EmailStr
    full_name: Optional[str] = None
    disabled: Optional[bool] = False
    created_at: Optional[datetime] = None

class UserInDB(User):
    """User model with hashed password"""
    hashed_password: str

class Token(BaseModel):
    """Token model"""
    access_token: str
    token_type: str
    email: Optional[str] = None
    full_name: Optional[str] = None

class TokenData(BaseModel):
    """Token data model"""
    username: Optional[str] = None
