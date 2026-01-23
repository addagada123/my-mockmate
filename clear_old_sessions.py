"""Clear old user sessions with questionVersion < 3"""
import os
import sys
from dotenv import load_dotenv

# Add parent directory to path
sys.path.insert(0, os.path.dirname(__file__))

load_dotenv()

# Import after adding to path
from backend.db.mongo import init_db, get_db

# Initialize database
init_db()
db = get_db()

user_sessions = db.get_collection("user_sessions")

# Delete all sessions with questionVersion < 3
result = user_sessions.delete_many({"questionVersion": {"$lt": 3}})
print(f"✅ Deleted {result.deleted_count} old sessions with questionVersion < 3")

# Show remaining sessions
remaining = list(user_sessions.find({}, {"email": 1, "questionVersion": 1, "questionCount": 1}))
print(f"\n📊 Remaining sessions ({len(remaining)}):")
for session in remaining:
    print(f"  - {session.get('email')}: v{session.get('questionVersion', 0)}, {session.get('questionCount', 0)} questions")
