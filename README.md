

## Environment variables
 - `MONGO_URI` — full MongoDB connection string (preferred).
 - `MONGO_USER` and `MONGO_PASSWORD` — if you prefer to build the URI from parts (used with `MONGO_HOST`).
 - `MONGO_HOST` — host for Mongo (default: localhost:27017). For Atlas use the cluster host (e.g. cluster0.xyz.mongodb.net).
 - `MONGO_DB` — database name (default: Endeavor).
 - `MONGO_COLLECTION` — collection name (default: ragCollection).

Note: For CPU-heavy LLMs, consider using a dedicated worker service or Render cron/jobs to offload processing.


Requirements files
------------------
- `requirements.txt` — slim production requirements for deployment (suitable for Render). Does NOT include heavy local ML stacks.
- `requirements-dev.txt` — development requirements that include `torch` and `sentence-transformers` for local embedding experiments. Install locally with:

```bash
pip install -r requirements-dev.txt
```


