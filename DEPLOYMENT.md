# Deploying Clardentity

Stack: **Vercel** (frontend) + **Render** (backend, with the Celery worker
running in-process — see note below) + **Supabase** (Postgres/pgvector +
Storage) + **Upstash** (Redis, Celery broker).

## Status

- [x] Supabase Postgres schema migrated (`alembic upgrade head`), pgvector 0.8.2 enabled.
- [x] Supabase Storage bucket `clardentity-prod` created.
- [x] Upstash Redis connected and verified (`PONG`).
- [x] GitHub push access to `clardentity/clardentity-mvp` (pushed to `main`).
- [x] Render web service `clardentity-backend` created via API, deploying.
- [ ] Vercel frontend deploy.
- [ ] Update `BACKEND_CORS_ORIGINS` on Render with the real Vercel URL once known.

## Render: single service, not two

Render's free plan only supports the `web_service` type — background workers
are a paid-tier feature (`POST /v1/services` with `type: background_worker`
returns `"only web services allowed for plan"`). Rather than pay for a second
service, the Celery worker runs as a second process inside the same
container: `backend/start.sh` backgrounds `celery -A app.core.celery_app
worker` and then `exec`s uvicorn in the foreground, so the container's
lifecycle is tied to the web server. If Celery crashes, HTTP traffic is
unaffected; only background tasks (document ingestion, memory rebuild) stop
processing until the next deploy/restart.

Trade-off worth knowing: on Render's free tier the service spins down after
inactivity. While asleep, the in-process worker is asleep too, so anything
queued sits in Redis until the next request wakes the container.

`render.yaml` (repo root) reflects this — one `web` service, no `worker`
entry. It's descriptive/for-reference; the actual deploy was done via
Render's API directly (`POST /v1/services`) rather than the Blueprint UI,
since a Render API key was available.

## Remaining: wire up the real Vercel origin

1. Deploy the frontend (see below) and note its `*.vercel.app` URL.
2. Update the `BACKEND_CORS_ORIGINS` env var on the `clardentity-backend`
   Render service to that URL (currently set to `http://localhost:3000` as a
   placeholder).
3. Manual redeploy on Render (or it'll pick it up on the next push).

## Vercel (frontend)

```bash
cd frontend
vercel link    # first time: set root directory to "frontend" if asked
vercel env add NEXT_PUBLIC_BACKEND_URL production   # paste the Render backend's public URL
vercel deploy --prod
```

## Notes

- `alembic/env.py` escapes literal `%` characters in `DATABASE_URL` before
  handing it to Alembic's configparser-backed config — without this, any DB
  password containing a URL-encoded character (like Supabase's here) breaks
  `alembic upgrade head` with "invalid interpolation syntax".
- Local dev is untouched — all of the above is prod-only config layered on
  top via env vars, not changes to defaults.
- Secrets (DB password, Redis password, S3 keys, JWT secret, OpenAI key) live
  only in Render's env vars and this local session's history — never
  committed. This repo is public.
