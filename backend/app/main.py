from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.chat import router as chat_router
from app.api.documents import router as documents_router
from app.api.health import router as health_router
from app.api.memory import router as memory_router
from app.api.validation import router as validation_router
from app.api.workspaces import router as workspaces_router
from app.core.config import settings

app = FastAPI(title="Clardentity API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_PREFIX = "/api/v1"

app.include_router(health_router)
app.include_router(auth_router, prefix=API_PREFIX)
app.include_router(workspaces_router, prefix=API_PREFIX)
app.include_router(chat_router, prefix=API_PREFIX)
app.include_router(documents_router, prefix=API_PREFIX)
app.include_router(memory_router, prefix=API_PREFIX)
app.include_router(validation_router, prefix=API_PREFIX)
