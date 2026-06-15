"""Pydantic request/response models."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = "ok"
    service: str = "Side Note API"
    version: str = "1.0.0"


class CreateSessionRequest(BaseModel):
    student_name: str | None = None
    exam_id: str = "practice-biology"


class SessionCreatedResponse(BaseModel):
    id: str
    student_name: str | None = None
    exam_id: str
    status: str
    created_at: str


class CalibrationRequest(BaseModel):
    points_completed: int = Field(ge=0, le=9)
    cancelled: bool = False
    avg_error_px: float | None = None
    passed: bool | None = None


class EventRequest(BaseModel):
    status: str = Field(pattern="^(ok|warning|suspicious)$")
    messages: list[str] = Field(default_factory=list)


class ViewportInfo(BaseModel):
    width: int
    height: int


class SubmitReportRequest(BaseModel):
    integrity_score: int = Field(ge=0, le=100)
    suspicious_count: int = Field(ge=0)
    warning_count: int = Field(ge=0)
    duration_seconds: int = Field(ge=0)
    events: list[dict[str, Any]] = Field(default_factory=list)
    calibration: dict[str, Any] | None = None
    viewport: ViewportInfo | None = None


class SessionSummary(BaseModel):
    id: str
    student_name: str | None = None
    exam_id: str | None = None
    status: str
    created_at: str
    submitted_at: str | None = None
    integrity_score: int | None = None
    suspicious_count: int | None = None
    warning_count: int | None = None
    duration_seconds: int | None = None
