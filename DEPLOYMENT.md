# Deploying Clardentity

Stack: **Vercel** (frontend) + **Render** (backend, with the Celery worker
running in-process — see note below) + **Supabase** (Postgres/pgvector +
Storage) + **Upstash** (Redis, Celery broker).

## Status

- [x] Supabase Postgres schema migrated (`alembic upgrade head`), pgvector 0.8.2 enabled.
- [x] Supabase Storage bucket `clardentity-prod` created.
- [x] Upstash Redis connected and verified (`PONG`).
- [x] GitHub push access to `clardentity/clardentity-mvp` (pushed to `main`).
- [x] Render web service `clardentity-backend` deployed at https://clardentity-backend.onrender.com — `/health` reports all three dependencies `ok`.
- [x] Vercel frontend deployed at https://frontend-eight-blush-49.vercel.app.
- [x] `BACKEND_CORS_ORIGINS` on Render set to the real Vercel URL.
- [ ] Auto-deploy on push isn't wired up yet — see below.

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
Render's API directly (`POST /v1/services`), since a Render API key was
available and that's faster to drive than the Blueprint dashboard UI.

## Supabase DB connection: pooler, not direct

`db.<project-ref>.supabase.co:5432` (the "direct connection" host Supabase
shows first) resolves to an **IPv6-only** address. Render's containers are
IPv4-only egress, so the direct host is unreachable from there. Use the
Supavisor **transaction pooler** instead:

```
postgresql+asyncpg://postgres.<project-ref>:<url-encoded password>@aws-<N>-<region>.pooler.supabase.com:6543/postgres
```

Username is `postgres.<project-ref>`, not just `postgres`; the `aws-<N>-`
prefix number varies per project — pull the exact string from Dashboard →
Project Settings → Database → Connection pooling (Transaction mode) rather
than guessing it.

A second, related gotcha: in transaction-pooling mode the backend connection
behind a session can change between statements, which breaks asyncpg's
default server-side prepared-statement cache (surfaced as `/health`
intermittently flapping between `database: ok` and `database: error`).
`app/db/session.py` sets `connect_args={"statement_cache_size": 0}` on both
engines to fix this — it's a no-op against local dev's direct connection, so
nothing to configure differently there.

## Vercel (frontend)

```bash
cd frontend
vercel link    # first time: set root directory to "frontend" if asked
vercel env add NEXT_PUBLIC_BACKEND_URL production   # paste the Render backend's public URL
vercel deploy --prod
```

## Auto-deploy on push isn't wired up

The Render service was created via `POST /v1/services` with a plain repo
URL, not through Render's dashboard "Connect GitHub" OAuth flow — so Render's
GitHub App was never installed on the repo, and pushing to `main` doesn't
trigger a deploy automatically (`autoDeploy: yes` is set on the service, but
nothing calls the hook). Until that's connected, ship a change with:

```bash
curl -H "Authorization: Bearer $RENDER_API_KEY" -H "Content-Type: application/json" \
  -X POST "https://api.render.com/v1/services/srv-d9jm8vb7uimc739rr0pg/deploys" \
  -d '{"clearCache": "do_not_clear"}'
```

To fix properly: Render dashboard → the `clardentity-backend` service →
Settings → connect/reconnect the GitHub repo through the UI (this installs
Render's GitHub App and registers the webhook).

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
