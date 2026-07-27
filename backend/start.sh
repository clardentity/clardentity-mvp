#!/bin/sh
# Render's free plan only allows a single "web service" (no separate
# background-worker plan tier) - so the Celery consumer runs alongside
# uvicorn in the same container instead of as its own Render service.
# If it crashes, uvicorn (the process the container's lifecycle is tied to)
# keeps serving HTTP traffic; only background task processing is lost until
# the next deploy/restart.
celery -A app.core.celery_app worker --loglevel=info &
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
