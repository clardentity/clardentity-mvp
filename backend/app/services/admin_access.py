"""Who counts as an administrator, and how the first one comes to exist.

The admin view lists every account's email address and what each has spent,
so "any signed-in user" - which is all the existing /admin/settings endpoints
require - is not a sufficient gate for it. Membership is an explicit list of
addresses in configuration, not a column anyone can set through the app: a
privilege that can be granted from inside the product is a privilege an
attacker can grant themselves.
"""

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import hash_password
from app.models import User
# Imported lazily inside the function: app.api.auth imports this module's
# sibling settings and importing it at module scope closes a cycle.

logger = logging.getLogger("clardentity.admin")


def admin_emails() -> set[str]:
    return {e.strip().lower() for e in settings.admin_emails.split(",") if e.strip()}


def is_admin(user: User) -> bool:
    """An exact match on the stored address. Emails are stored lower-cased
    (see auth._email_key), so a row whose address differs from its
    lower-cased form - "ADMIN@clardentity.ai", registered before that rule -
    is not the administrator. Comparing case-insensitively here, against
    accounts anyone can register, let a user make themselves admin."""
    email = user.email or ""
    return email == email.strip().lower() and email in admin_emails()


async def ensure_bootstrap_admin(db: AsyncSession) -> None:
    """Create the configured administrator if it is missing.

    Runs at boot. Does nothing without a password configured, and never
    touches an account that already exists - so a rotated password is a
    deliberate act, and this cannot quietly reset one.
    """
    email = (settings.admin_bootstrap_email or "").strip().lower()
    password = settings.admin_bootstrap_password
    if not email or not password:
        return

    existing = await db.scalar(select(User).where(User.email == email))
    if existing is not None:
        return

    user = User(
        email=email,
        password_hash=hash_password(password),
        display_name="Admin",
        # The operator accepted the terms by deploying the thing; recording a
        # bootstrap account as having accepted them would be a lie in a column
        # that exists to be honest.
        onboarding_completed_at=None,
    )
    db.add(user)
    await db.flush()
    from app.api.auth import provision_new_user

    await provision_new_user(db, user)
    await db.commit()
    logger.info("bootstrap admin account created for %s", email)
