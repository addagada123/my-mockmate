import os
import sys
from dotenv import load_dotenv
from pymongo import MongoClient

# Load .env
load_dotenv()

uri = os.getenv("MONGO_URI")
print(f"Testing connection to: {uri.split('@')[-1] if '@' in uri else uri}")

import certifi

try:
    client = MongoClient(uri, serverSelectionTimeoutMS=5000, tlsAllowInvalidCertificates=True, tlsCAFile=certifi.where())
    info = client.server_info()
    print("✅ MongoDB Connection Successful!")
    print(f"Version: {info.get('version')}")
except Exception as e:
    print(f"❌ MongoDB Connection Failed: {e}")
