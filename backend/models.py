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
    calibration: dict[str, Any] | None = None


class IdentityRequest(BaseModel):
    student_name: str = Field(..., min_length=2, max_length=120)


class SessionCreatedResponse(BaseModel):
    id: str
    student_name: str | None = None
    exam_id: str
    status: str
    created_at: str


class CalibrationRequest(BaseModel):
    """Canonical fields: avg_error_px, passed, points. Legacy aliases accepted."""

    avg_error_px: float | None = None
    passed: bool | None = None
    points: int | None = Field(default=None, ge=0, le=9)
    points_completed: int | None = Field(default=None, ge=0, le=9)
    cancelled: bool = False
    pass_threshold_px: float | None = None
    training_samples: int | None = None

    def normalized(self) -> dict[str, Any]:
        points = self.points if self.points is not None else self.points_completed
        if points is None:
            points = 0
        return {
            "avg_error_px": self.avg_error_px,
            "passed": self.passed,
            "points": points,
            "pass_threshold_px": self.pass_threshold_px,
            "training_samples": self.training_samples,
            "cancelled": self.cancelled,
        }

class EventRequest(BaseModel):
    """Legacy clients may send only status + messages; new fields are optional."""

    status: str = Field(pattern="^(ok|warning|suspicious)$")
    messages: list[str] = Field(default_factory=list)
    flag_id: str | None = Field(default=None, max_length=64)
    severity: str | None = Field(
        default=None,
        pattern="^(ok|info|warning|suspicious)$",
    )
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    evidence_path: str | None = Field(default=None, max_length=512)


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
    evidence: list[dict[str, Any]] = Field(default_factory=list)


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
