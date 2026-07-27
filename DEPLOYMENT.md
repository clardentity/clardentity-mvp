# Deploying Clardentity

Stack: **Vercel** (frontend) + **Render** (backend + Celery worker) + **Supabase**
(Postgres/pgvector + Storage) + **Upstash** (Redis, Celery broker).

## Status

- [x] Supabase Postgres schema migrated (`alembic upgrade head`), pgvector 0.8.2 enabled.
- [ ] Supabase Storage bucket for document uploads.
- [ ] Upstash Redis connected (have REST token, need the native protocol password for `REDIS_URL`).
- [ ] GitHub push access to `clardentity/clardentity-mvp`.
- [ ] Render web service + Celery worker (blueprint ready at `render.yaml`, not yet deployed).
- [ ] Vercel frontend deploy.

## 1. Supabase

Already provisioned: project `imbpnzpwpgzuwdnuzlhf`, Postgres 17, pgvector 0.8.2,
all 14 tables migrated.

Still needed — Storage bucket for document uploads (S3-compatible API):
1. Dashboard → Storage → create a bucket named `clardentity-prod`.
2. Dashboard → Project Settings → Storage → "S3 Connection" → copy the S3-compatible
   endpoint, access key ID, and secret access key. These become `S3_ENDPOINT`,
   `S3_ACCESS_KEY`, `S3_SECRET_KEY` in Render's env vars.

## 2. Upstash Redis

Have: endpoint `notable-ray-135722.upstash.io`, port 6379, TLS enabled, REST
token. Still need the **native Redis password** (the one shown as dots in the
dashboard's "Password" field — click reveal) to build:

```
REDIS_URL=rediss://default:<password>@notable-ray-135722.upstash.io:6379
```

(`rediss://`, not `redis://` — TLS is enabled on this instance.)

## 3. GitHub

Repo `clardentity/clardentity-mvp` exists but is empty. Add `aloshdenny` as a
collaborator with write access (Settings → Collaborators) so the code can be
pushed from here.

## 4. Render (backend + Celery worker)

A blueprint is ready at `render.yaml` (repo root) — two services (`clardentity-backend`
web service, `clardentity-celery-worker`), both built from `backend/Dockerfile`,
sharing one env var group.

To deploy: sign in at render.com (GitHub login recommended so it can access the
repo), New → Blueprint → select `clardentity/clardentity-mvp` → Render reads
`render.yaml` and provisions both services. You'll be prompted for the env vars
marked `sync: false` — supply:

- `OPENAI_API_KEY`
- `DATABASE_URL` — `postgresql+asyncpg://postgres:<url-encoded password>@db.imbpnzpwpgzuwdnuzlhf.supabase.co:5432/postgres`
- `REDIS_URL` — from step 2
- `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` — from step 1
- `JWT_SECRET` — generate one with `openssl rand -hex 32` and paste it directly into
  Render's env var field; don't commit it anywhere (this repo is public)
- `BACKEND_CORS_ORIGINS` — the Vercel URL from step 5 (circular — deploy backend
  first with a placeholder, update once the Vercel URL is known, redeploy)

`preDeployCommand: alembic upgrade head` runs migrations automatically on every
deploy, so schema changes ship themselves.

## 5. Vercel (frontend)

```bash
cd frontend
vercel login   # your own browser OAuth flow
vercel link    # first time: set root directory to "frontend" if asked
vercel env add NEXT_PUBLIC_BACKEND_URL production   # paste the Render backend's public URL
vercel deploy --prod
```

After the first deploy, take the resulting `*.vercel.app` URL and set it as
`BACKEND_CORS_ORIGINS` in Render (step 4), then redeploy the backend so CORS
allows the real frontend origin.

## Notes

- `alembic/env.py` escapes literal `%` characters in `DATABASE_URL` before
  handing it to Alembic's configparser-backed config — without this, any DB
  password containing a URL-encoded character (like Supabase's here) breaks
  `alembic upgrade head` with "invalid interpolation syntax". Already fixed
  in the repo; don't need to think about it again.
- Local dev is untouched — all of the above is prod-only config layered on
  top via env vars, not changes to defaults.
