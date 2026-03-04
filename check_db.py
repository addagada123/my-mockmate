import os
import sys
from dotenv import load_dotenv
from pymongo import MongoClient

# Load .env
load_dotenv()

uri = os.getenv("MONGO_URI")
safe_uri = uri or ""
print(f"Testing connection to: {safe_uri.split('@')[-1] if '@' in safe_uri else safe_uri}")

import certifi

try:
    client = MongoClient(safe_uri, serverSelectionTimeoutMS=5000, tlsAllowInvalidCertificates=True, tlsCAFile=certifi.where())
    info = client.server_info()
    print("✅ MongoDB Connection Successful!")
    print(f"Version: {info.get('version')}")
except Exception as e:
    print(f"❌ MongoDB Connection Failed: {e}")
