import logging
import os

import certifi
from fastapi import HTTPException
from pymongo import MongoClient
from pymongo.database import Database
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# MongoDB connection
client = None
db = None

def init_db() -> Database:
    """Initialize MongoDB connection"""
    global client, db

    # Prefer cloud URI if provided, fall back to local
    mongodb_uri = (
        os.getenv("MONGODB_URI")
        or os.getenv("MONGO_URI")
        or "mongodb://localhost:27017/"
    )
    database_name = os.getenv("DATABASE_NAME") or os.getenv("MONGO_DB") or "endeavor_rag"

    try:
        client = MongoClient(mongodb_uri, serverSelectionTimeoutMS=5000, tlsAllowInvalidCertificates=True, tlsCAFile=certifi.where())
        # Force connection check
        client.server_info()
        db = client[database_name]
        logger.info("✅ Connected to MongoDB: %s", database_name)
        # Ensure indexes for fast auth lookups
        try:
            db.users.create_index("email", unique=True, sparse=True)
            db.users.create_index("username", unique=True, sparse=True)
            logger.info("✅ Auth indexes ensured on users collection")
        except Exception as idx_exc:
            logger.warning("⚠️ Could not create indexes: %s", idx_exc)
        return db
    except Exception as exc:  # pragma: no cover
        logger.error("MongoDB connection failed: %s. Switching to MOCK DATABASE.", exc)
        # Fallback to Mock DB
        from backend.db.mock_mongo import MockClient
        client = MockClient()
        db = client[database_name]
        logger.warning("⚠️ USING IN-MEMORY MOCK DATABASE. DATA WILL BE LOST ON RESTART.")
        return db

def get_db() -> Database:
    """Get database instance"""
    global db
    if db is None:
        return init_db()
    return db

def close_db():
    """Close MongoDB connection"""
    global client
    if client:
        client.close()
        print("✅ MongoDB connection closed")
