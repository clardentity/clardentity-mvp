import contextvars
import logging
import sys

correlation_id_var: contextvars.ContextVar[str] = contextvars.ContextVar(
    "correlation_id", default="-"
)


class _CorrelationIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.correlation_id = correlation_id_var.get()
        return True


def configure_logging() -> None:
    """§14 Observability: structured logging + request tracing via a
    correlation ID threaded through contextvars (see
    app.core.middleware.CorrelationIdMiddleware), so every log line emitted
    while handling a request - across services, not just the route handler -
    carries the same ID.
    """
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter(
            "%(asctime)s %(levelname)s [%(name)s] correlation_id=%(correlation_id)s %(message)s"
        )
    )
    handler.addFilter(_CorrelationIdFilter())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)
