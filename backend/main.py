"""BudgetLens Backend FastAPI Entrypoint."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.db import init_tips_db
from backend.routers.ai import router as ai_router
from backend.routers.expenditures import router as expenditures_router
from backend.routers.procurement import router as procurement_router
from backend.routers.search import get_fts_db_path, router as search_router
from backend.routers.tips import router as tips_router

app = FastAPI(
    title="BudgetLens Civic Fiscal Observatory API",
    version="2.0.0",
    description="All-28-Year SQLite FTS5 Search, Strict-Grounding Hybrid RAG, and Citizen Field Tips API (1999-2026)",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(search_router)
app.include_router(ai_router)
app.include_router(tips_router)
app.include_router(procurement_router)
app.include_router(expenditures_router)
init_tips_db()


@app.get("/api/health")
def health() -> dict[str, object]:
    db_path = get_fts_db_path()
    return {
        "status": "ok",
        "ftsDbReady": db_path.exists(),
    }
