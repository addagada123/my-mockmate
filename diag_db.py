import os
import sys

# Inject .venv path to help IDE and runtime find imports
base_path = os.path.dirname(os.path.abspath(__file__))
venv_path = os.path.join(base_path, ".venv", "Lib", "site-packages")
if os.path.exists(venv_path) and venv_path not in sys.path:
    sys.path.insert(0, venv_path)
if base_path not in sys.path:
    sys.path.insert(0, base_path)

from dotenv import load_dotenv
from pymongo import MongoClient
import certifi

load_dotenv()

uri = os.getenv("MONGODB_URI") or os.getenv("MONGO_URI") or "mongodb://localhost:27017/"
client = MongoClient(uri, tlsAllowInvalidCertificates=True, tlsCAFile=certifi.where())

print("--- Database Diagnostics ---")
dbs = [d for d in client.list_database_names() if d not in ['admin', 'local', 'config', 'sample_mflix']]
print(f"Relevant Databases: {dbs}")

for db_name in dbs:
    db = client[db_name]
    cols = db.list_collection_names()
    print(f"\nDatabase: {db_name}")
    for col_name in cols:
        count = db[col_name].count_documents({})
        print(f"  - {col_name}: {count} documents")
        if col_name == "user_sessions":
            latest = db[col_name].find_one(sort=[("created_at", -1)])
            if latest:
                print(f"    Latest Session: {latest.get('_id')} (Has VR: {'vr_test' in latest})")
