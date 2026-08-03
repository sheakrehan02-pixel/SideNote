"""Server-side integrity scoring (matches browser + FLAG_TAXONOMY).

Weights (per logged non-ok event; highest applicable wins):
  phone_risk @ suspicious  → −12
  other     @ suspicious  → −8   (looking_down, gaze_off_screen, face_not_visible, …)
  any       @ warning     → −2
  info / ok               → 0

Priority when an event carries multiple signals:
  phone_risk > looking_down (and peer suspicious flags) > warning.
"""

from __future__ import annotations

from typing import Any

# Score deltas — keep in sync with website/js/cheating-detector.js getReport()
# and docs/FLAG_TAXONOMY.md § Severity & scoring policy.
WEIGHT_PHONE_RISK_SUSPICIOUS = 12
WEIGHT_SUSPICIOUS = 8
WEIGHT_WARNING = 2

# Higher = preferred when choosing which signal drives the event penalty.
FLAG_PRIORITY: dict[str, int] = {
    "phone_risk": 100,
    "looking_down": 50,
    "gaze_off_screen": 50,
    "face_not_visible": 40,
    "hands_in_lap": 30,
    "multiple_faces": 20,
}

_SEVERITY_RANK = {"ok": 0, "info": 1, "warning": 2, "suspicious": 3}

# Legacy message → flag_id (docs/FLAG_TAXONOMY.md / EVAL_PROTOCOL.md)
_MESSAGE_FLAG_HINTS: tuple[tuple[str, str], ...] = (
    ("possible phone", "phone_risk"),
    ("hands in lap", "hands_in_lap"),
    ("hands appear below", "hands_in_lap"),
    ("looking down", "looking_down"),
    ("bottom of the screen", "looking_down"),
    ("off to the side", "gaze_off_screen"),
    ("edge of the screen", "gaze_off_screen"),
    ("cannot see your face", "face_not_visible"),
    ("face has been missing", "face_not_visible"),
    ("face not", "face_not_visible"),
)


def _infer_flag_from_messages(messages: list[Any]) -> str | None:
    blob = " ".join(str(m) for m in messages).lower()
    for needle, flag_id in _MESSAGE_FLAG_HINTS:
        if needle in blob:
            return flag_id
    return None


def _event_flags(event: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalize to a list of {id, severity} for scoring."""
    flags: list[dict[str, Any]] = []

    nested = event.get("flags")
    if isinstance(nested, list):
        for f in nested:
            if not isinstance(f, dict):
                continue
            fid = f.get("id") or f.get("flag_id")
            if not fid:
                continue
            sev = f.get("severity") or event.get("severity") or event.get("status") or "warning"
            flags.append({"id": str(fid), "severity": str(sev)})

    flag_id = event.get("flag_id")
    if flag_id:
        sev = event.get("severity") or event.get("status") or "warning"
        flags.append({"id": str(flag_id), "severity": str(sev)})

    if not flags:
        inferred = _infer_flag_from_messages(event.get("messages") or [])
        status = event.get("status") or event.get("severity") or "warning"
        if inferred:
            flags.append({"id": inferred, "severity": str(status)})
        elif status in ("warning", "suspicious"):
            # Untyped legacy event — treat by status only
            flags.append({"id": "_untagged", "severity": str(status)})

    return flags


def _flag_sort_key(flag: dict[str, Any]) -> tuple[int, int]:
    sev = _SEVERITY_RANK.get(str(flag.get("severity") or ""), 0)
    pri = FLAG_PRIORITY.get(str(flag.get("id") or ""), 0)
    return (sev, pri)


def _penalty_for_flag(flag: dict[str, Any]) -> int:
    fid = str(flag.get("id") or "")
    sev = str(flag.get("severity") or "")
    if sev == "suspicious":
        if fid == "phone_risk":
            return WEIGHT_PHONE_RISK_SUSPICIOUS
        return WEIGHT_SUSPICIOUS
    if sev == "warning":
        return WEIGHT_WARNING
    return 0


def event_penalty(event: dict[str, Any]) -> tuple[int, str | None, str]:
    """
    Return (penalty, winning_flag_id, winning_severity) for one event.

    Uses the highest-weight signal on the event (phone_risk > looking_down >
    warning), matching UI priority when severities tie.
    """
    status = str(event.get("status") or "")
    if status == "ok":
        return 0, None, "ok"

    flags = _event_flags(event)
    if not flags:
        return 0, None, status or "ok"

    # Prefer highest severity, then FLAG_PRIORITY (phone_risk > looking_down > …)
    winner = max(flags, key=_flag_sort_key)
    # Also compare raw penalty so phone_risk suspicious beats looking_down suspicious
    # even if somehow ranked equal.
    best = winner
    best_pen = _penalty_for_flag(winner)
    for f in flags:
        pen = _penalty_for_flag(f)
        if pen > best_pen or (
            pen == best_pen and _flag_sort_key(f) > _flag_sort_key(best)
        ):
            best = f
            best_pen = pen

    return best_pen, str(best.get("id") or "") or None, str(best.get("severity") or status)


def compute_integrity_score(events: list[dict[str, Any]]) -> dict[str, Any]:
    """Recompute integrity score from weighted flags (server source of truth)."""
    score = 100
    suspicious = 0
    warnings = 0
    phone_risk_suspicious = 0
    looking_down_suspicious = 0
    breakdown: list[dict[str, Any]] = []

    for event in events:
        penalty, flag_id, severity = event_penalty(event)
        if penalty <= 0:
            continue

        score -= penalty
        if severity == "suspicious":
            suspicious += 1
            if flag_id == "phone_risk":
                phone_risk_suspicious += 1
            elif flag_id == "looking_down":
                looking_down_suspicious += 1
        elif severity == "warning":
            warnings += 1

        breakdown.append(
            {
                "flag_id": flag_id,
                "severity": severity,
                "penalty": penalty,
            }
        )

    return {
        "integrity_score": max(0, score),
        "suspicious_count": suspicious,
        "warning_count": warnings,
        "phone_risk_suspicious_count": phone_risk_suspicious,
        "looking_down_suspicious_count": looking_down_suspicious,
        "breakdown": breakdown,
    }


def normalize_report(report: dict[str, Any]) -> dict[str, Any]:
    """Overwrite client-sent score with server recomputation from weighted flags."""
    events = report.get("events") or []
    computed = compute_integrity_score(events)
    evidence = report.get("evidence") or []
    # Keep only entries that still have a viewable image (data URL or path/URL)
    cleaned_evidence = []
    for item in evidence:
        if not isinstance(item, dict):
            continue
        src = (
            item.get("imageDataUrl")
            or item.get("image_data_url")
            or item.get("url")
            or item.get("path")
            or item.get("evidence_path")
        )
        if not src:
            continue
        cleaned_evidence.append(item)

    return {
        "integrity_score": computed["integrity_score"],
        "suspicious_count": computed["suspicious_count"],
        "warning_count": computed["warning_count"],
        "events": events,
        "calibration": report.get("calibration"),
        "duration_seconds": report.get("duration_seconds"),
        "viewport": report.get("viewport"),
        "evidence": cleaned_evidence,
        "scoring": {
            "weights": {
                "phone_risk_suspicious": WEIGHT_PHONE_RISK_SUSPICIOUS,
                "suspicious": WEIGHT_SUSPICIOUS,
                "warning": WEIGHT_WARNING,
            },
            "phone_risk_suspicious_count": computed["phone_risk_suspicious_count"],
            "looking_down_suspicious_count": computed["looking_down_suspicious_count"],
            "breakdown": computed["breakdown"],
        },
    }
