#!/bin/sh
# Render's free plan only allows a single "web service" (no separate
# background-worker plan tier), so the Celery consumer runs alongside uvicorn
# in the same container instead of as its own Render service. If it crashes,
# uvicorn (the process the container's lifecycle is tied to) keeps serving
# HTTP traffic; only background task processing is lost until the next
# deploy/restart.
#
# --concurrency=1 is load-bearing, not a default worth tuning up. Celery's
# prefork pool defaults to one child per CPU, which on this host meant 8
# children + parent + uvicorn in a 512 MB container - the deploy was OOM-killed
# (exit 137) the moment the worker actually started successfully. The workload
# here is a trickle of document ingestions and memory rebuilds, so a single
# child is ample.
#
# gossip/mingle/heartbeat only coordinate a multi-worker cluster; with one
# worker they buy nothing and add Redis chatter. max-tasks-per-child recycles
# the child periodically so a slow leak can't accumulate.
celery -A app.core.celery_app worker \
  --loglevel=info \
  --concurrency=1 \
  --max-tasks-per-child=100 \
  --without-gossip --without-mingle --without-heartbeat &

exec uvicorn app.main:app --host 0.0.0.0 --port 8000
