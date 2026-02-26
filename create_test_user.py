"""Create a test user in the mock database"""
import asyncio
from backend.db.mongo import get_db
from backend.auth.utils import get_password_hash
from datetime import datetime

def create_test_user():
    db = get_db()
    
    # Check if test user already exists
    existing = db.users.find_one({"email": "test@example.com"})
    if existing:
        print("✅ Test user already exists")
        print(f"   Email: test@example.com")
        print(f"   Password: testpassword123")
        return
    
    # Create test user
    user_dict = {
        "username": "testuser",
        "email": "test@example.com",
        "full_name": "Test User",
        "hashed_password": get_password_hash("testpassword123"),
        "disabled": False,
        "created_at": datetime.now()
    }
    
    result = db.users.insert_one(user_dict)
    print("✅ Test user created successfully!")
    print(f"   Email: test@example.com")
    print(f"   Password: testpassword123")
    print(f"   User ID: {result.inserted_id}")

if __name__ == "__main__":
    create_test_user()
