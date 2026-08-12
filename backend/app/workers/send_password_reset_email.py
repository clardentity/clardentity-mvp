import asyncio
from urllib.parse import quote

from app.core.celery_app import celery_app
from app.core.config import settings
from app.core.security import PASSWORD_RESET_TOKEN_EXPIRE_MINUTES
from app.services.email_service import password_reset_html, send_email


@celery_app.task(name="send_password_reset_email")
def send_password_reset_email_task(email: str, token: str) -> None:
    """Queued rather than awaited so the request that triggers it answers in
    the same time whether or not the address belongs to an account - a reset
    endpoint that is measurably slower for real users is an account-existence
    oracle.
    """
    reset_url = f"{settings.app_url.rstrip('/')}/reset-password?token={quote(token)}"
    asyncio.run(
        send_email(
            to=email,
            subject="Reset your Clardentity password",
            html=password_reset_html(reset_url, PASSWORD_RESET_TOKEN_EXPIRE_MINUTES),
        )
    )
