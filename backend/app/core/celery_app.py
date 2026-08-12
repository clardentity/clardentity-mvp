from celery import Celery

from app.core.config import settings


def _celery_redis_url(url: str) -> str:
    """kombu refuses a `rediss://` URL that doesn't spell out `ssl_cert_reqs`,
    raising at worker startup with "A rediss:// URL must have parameter
    ssl_cert_reqs". Upstash (and any managed TLS Redis) hands out exactly such
    a URL, so the parameter is appended here rather than baked into the
    REDIS_URL env var - redis-py, which the rate limiter uses directly, is
    happy either way and shouldn't have to carry a Celery quirk.
    """
    if not url.startswith("rediss://") or "ssl_cert_reqs=" in url:
        return url
    separator = "&" if "?" in url else "?"
    return f"{url}{separator}ssl_cert_reqs=required"


_broker_url = _celery_redis_url(settings.redis_url)

celery_app = Celery(
    "clardentity",
    broker=_broker_url,
    backend=_broker_url,
    include=[
        "app.workers.ingest_document",
        "app.workers.rebuild_memory",
        "app.workers.rebuild_profile",
        "app.workers.send_password_reset_email",
        "app.workers.send_welcome_email",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
)
