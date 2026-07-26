from celery import Celery

from app.core.config import settings

celery_app = Celery(
    "clardentity",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.workers.ingest_document", "app.workers.rebuild_memory"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
)
