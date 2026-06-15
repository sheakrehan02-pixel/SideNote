"""Server-side integrity scoring (matches browser heuristics)."""

from __future__ import annotations

from typing import Any


def compute_integrity_score(events: list[dict[str, Any]]) -> dict[str, int]:
    suspicious = sum(1 for e in events if e.get("status") == "suspicious")
    warnings = sum(1 for e in events if e.get("status") == "warning")
    score = max(0, 100 - suspicious * 8 - warnings * 2)
    return {
        "integrity_score": score,
        "suspicious_count": suspicious,
        "warning_count": warnings,
    }


def normalize_report(report: dict[str, Any]) -> dict[str, Any]:
    events = report.get("events") or []
    computed = compute_integrity_score(events)
    return {
        "integrity_score": computed["integrity_score"],
        "suspicious_count": computed["suspicious_count"],
        "warning_count": computed["warning_count"],
        "events": events,
        "calibration": report.get("calibration"),
        "duration_seconds": report.get("duration_seconds"),
        "viewport": report.get("viewport"),
    }
