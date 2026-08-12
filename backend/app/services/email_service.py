"""Transactional email via Resend.

Deliberately a no-op when `RESEND_API_KEY` is unset: local development and
tests should not need an email provider, and a missing key must never break
registration. Sending is best-effort in every case - a failed welcome email is
logged, not surfaced to the user whose account was created successfully.
"""

import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

_RESEND_ENDPOINT = "https://api.resend.com/emails"


def email_enabled() -> bool:
    return bool(settings.resend_api_key)


async def send_email(*, to: str, subject: str, html: str) -> bool:
    """Returns True if the provider accepted it. Never raises."""
    if not email_enabled():
        logger.info("email skipped (no RESEND_API_KEY configured)", extra={"to": to})
        return False

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                _RESEND_ENDPOINT,
                headers={"Authorization": f"Bearer {settings.resend_api_key}"},
                json={
                    "from": settings.email_from,
                    "to": [to],
                    "subject": subject,
                    "html": html,
                },
            )
        if response.status_code >= 400:
            logger.warning(
                "email provider rejected the message",
                extra={"status": response.status_code, "body": response.text[:400]},
            )
            return False
        return True
    except Exception:
        logger.exception("email send failed")
        return False


def password_reset_html(reset_url: str, expires_minutes: int) -> str:
    return f"""\
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <div style="max-width:520px;margin:0 auto;padding:40px 24px;">
      <p style="font-size:15px;font-weight:600;color:#101828;margin:0 0 28px;">Clardentity</p>

      <h1 style="font-size:26px;line-height:1.25;color:#101828;margin:0 0 16px;font-weight:600;">
        Reset your password
      </h1>

      <p style="font-size:15px;line-height:1.6;color:#475467;margin:0 0 24px;">
        Use the button below to choose a new password. The link works once and
        expires in {expires_minutes} minutes.
      </p>

      <a href="{reset_url}"
         style="display:inline-block;background:#5b4bc4;color:#ffffff;text-decoration:none;
                padding:12px 22px;border-radius:999px;font-size:15px;font-weight:500;">
        Choose a new password
      </a>

      <p style="font-size:13px;line-height:1.6;color:#667085;margin:32px 0 0;">
        If you didn't ask for this, you can ignore this email - your password
        stays as it is, and the link above does nothing until it's used.
      </p>
    </div>
  </body>
</html>"""


def welcome_html(display_name: str | None, app_url: str) -> str:
    greeting = f"Hi {display_name}," if display_name else "Hi,"
    return f"""\
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <div style="max-width:520px;margin:0 auto;padding:40px 24px;">
      <p style="font-size:15px;font-weight:600;color:#101828;margin:0 0 28px;">Clardentity</p>

      <h1 style="font-size:26px;line-height:1.25;color:#101828;margin:0 0 16px;font-weight:600;">
        Welcome aboard.
      </h1>

      <p style="font-size:15px;line-height:1.6;color:#475467;margin:0 0 16px;">
        {greeting} your room is already set up &mdash; there's nothing to
        configure before you ask your first question.
      </p>

      <p style="font-size:15px;line-height:1.6;color:#475467;margin:0 0 16px;">
        A few things worth knowing:
      </p>

      <ul style="font-size:15px;line-height:1.7;color:#475467;margin:0 0 24px;padding-left:20px;">
        <li><strong style="color:#101828;">You pick the mode.</strong> Knowing, Thinking,
            Decision or Learning &mdash; it never guesses which you meant.</li>
        <li><strong style="color:#101828;">Upload your documents.</strong> Answers get cited
            against them, and say so plainly when something isn't there.</li>
        <li><strong style="color:#101828;">Every claim is scored.</strong> You can open the
            evidence behind any answer and see exactly what it rests on.</li>
      </ul>

      <a href="{app_url}"
         style="display:inline-block;background:#5b4bc4;color:#ffffff;text-decoration:none;
                padding:12px 22px;border-radius:999px;font-size:15px;font-weight:500;">
        Ask your first question
      </a>

      <p style="font-size:13px;line-height:1.6;color:#667085;margin:32px 0 0;">
        You're receiving this because an account was created with this address.
      </p>
    </div>
  </body>
</html>"""
