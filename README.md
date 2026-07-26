# Clardentity

A cognitive layer over OpenAI's Responses API: four user-selected companion
modes (Knowing / Thinking / Decision / Learning), RAG + conversation memory,
per-claim/per-evidence validation, and a generic avatar companion. See the
SRS PDF in this directory for the full spec.

Build status: **Phase 4 of 8 complete** (scaffold, auth, chat core, document
ingestion + RAG). See `.claude` plan history or ask the assistant for the
current phase.

## Local development

This machine doesn't have Docker installed, so the local stack runs via
Homebrew-managed native services instead of containers. (`infra/docker-compose.yml`
is kept for parity/reference if you ever want to run it under Docker or Colima.)

### One-time setup

```bash
# Postgres 17 (with pgvector) — you likely already have this running via:
brew services start postgresql@17

# Redis
brew install redis
brew services start redis

# MinIO (S3-compatible object storage) + client
brew install minio minio-mc
brew services start minio
mc alias set local http://localhost:9000 minioadmin minioadmin
mc mb local/clardentity-dev
```

Create the app's Postgres role/database and enable `pgvector` (run as your
Postgres superuser, typically your macOS username):

```bash
psql -d postgres -c "CREATE ROLE clardentity WITH LOGIN PASSWORD 'clardentity_dev_pw' CREATEDB;"
psql -d postgres -c "CREATE DATABASE clardentity OWNER clardentity;"
psql -d clardentity -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

Copy `.env.example` to `.env` at the repo root and fill in `OPENAI_API_KEY`
(everything else has sane local defaults matching the setup above).

### Backend (FastAPI)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Health check: `curl http://localhost:8000/health` should report `database`,
`redis`, and `storage` all `ok`.

### Celery worker (document ingestion)

Required for document uploads to actually get parsed/chunked/embedded — run
in a separate terminal, same venv:

```bash
cd backend
source .venv/bin/activate
celery -A app.core.celery_app worker --loglevel=info -P solo
```

`-P solo` avoids macOS fork-safety issues with the prefork pool; fine for
local dev at this scale.

### Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000.

## Repository layout

```
frontend/    Next.js (App Router) + TypeScript + Tailwind
backend/     FastAPI + SQLAlchemy (async) + Alembic + Celery
infra/       docker-compose.yml (optional containerized alternative)
```

## Cloud deployment (later, after local testing)

- Frontend → Vercel
- Backend → Render (free web service)
- Database + object storage → Supabase (Postgres with native pgvector +
  S3-compatible Storage) — same `boto3`/SQLAlchemy code, just swap the
  connection env vars
- Redis (Celery broker) → Upstash free tier
