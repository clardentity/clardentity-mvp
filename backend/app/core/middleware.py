import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

from app.core.logging_config import correlation_id_var


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    """Accepts an inbound X-Request-ID (useful if a frontend/proxy already
    assigns one) or mints a fresh one, threads it through contextvars for
    the duration of the request, and echoes it back in the response.
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next) -> Response:
        correlation_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        token = correlation_id_var.set(correlation_id)
        try:
            response = await call_next(request)
        finally:
            correlation_id_var.reset(token)
        response.headers["X-Request-ID"] = correlation_id
        return response
