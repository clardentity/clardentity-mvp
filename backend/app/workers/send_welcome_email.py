import asyncio

from app.core.celery_app import celery_app
from app.core.config import settings
from app.services.email_service import send_email, welcome_html


@celery_app.task(name="send_welcome_email")
def send_welcome_email_task(email: str, display_name: str | None) -> None:
    """Queued from registration so a slow or failing email provider can never
    delay or fail account creation.
    """
    asyncio.run(
        send_email(
            to=email,
            subject="Welcome to Clardentity",
            html=welcome_html(display_name, settings.app_url),
        )
    )
