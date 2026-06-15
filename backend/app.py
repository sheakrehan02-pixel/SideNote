"""FastAPI application — REST API + static website."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from backend import database as db
from backend.detector import normalize_report
from backend.models import (
    CalibrationRequest,
    CreateSessionRequest,
    EventRequest,
    HealthResponse,
    SessionCreatedResponse,
    SessionSummary,
    SubmitReportRequest,
)

WEBSITE_DIR = Path(__file__).resolve().parent.parent / "website"


def create_app() -> FastAPI:
    app = FastAPI(
        title="Side Note API",
        description="Proctoring session storage for Side Note eye-tracking exams",
        version="1.0.0",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.on_event("startup")
    def on_startup() -> None:
        db.init_db()

    @app.get("/api/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse()

    @app.post("/api/sessions", response_model=SessionCreatedResponse)
    def create_session(body: CreateSessionRequest) -> SessionCreatedResponse:
        session = db.create_session(
            student_name=body.student_name,
            exam_id=body.exam_id,
        )
        return SessionCreatedResponse(**session)

    @app.get("/api/sessions", response_model=list[SessionSummary])
    def list_sessions(limit: int = 50) -> list[SessionSummary]:
        limit = max(1, min(limit, 200))
        return [SessionSummary(**row) for row in db.list_sessions(limit=limit)]

    @app.get("/api/sessions/{session_id}")
    def get_session(session_id: str) -> JSONResponse:
        try:
            return JSONResponse(db.get_session(session_id))
        except KeyError:
            raise HTTPException(status_code=404, detail="Session not found")

    @app.post("/api/sessions/{session_id}/calibration")
    def record_calibration(session_id: str, body: CalibrationRequest) -> JSONResponse:
        try:
            db.save_calibration(session_id, body.model_dump())
            return JSONResponse({"ok": True, "session_id": session_id})
        except KeyError:
            raise HTTPException(status_code=404, detail="Session not found")

    @app.post("/api/sessions/{session_id}/events")
    def record_event(session_id: str, body: EventRequest) -> JSONResponse:
        if body.status == "ok":
            return JSONResponse({"ok": True, "skipped": True})
        try:
            event = db.add_event(session_id, body.status, body.messages)
            return JSONResponse(event)
        except KeyError:
            raise HTTPException(status_code=404, detail="Session not found")

    @app.post("/api/sessions/{session_id}/submit")
    def submit_session(session_id: str, body: SubmitReportRequest) -> JSONResponse:
        report = normalize_report(body.model_dump())
        try:
            session = db.submit_session(session_id, report)
            return JSONResponse(session)
        except KeyError:
            raise HTTPException(status_code=404, detail="Session not found")

    if WEBSITE_DIR.is_dir():
        app.mount("/", StaticFiles(directory=str(WEBSITE_DIR), html=True), name="website")

    return app


app = create_app()
