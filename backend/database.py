"""SQLite persistence for proctoring sessions."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Generator
from uuid import uuid4

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = DATA_DIR / "sidenote.db"


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with get_connection() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                student_name TEXT,
                exam_id TEXT DEFAULT 'practice-biology',
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL,
                submitted_at TEXT,
                integrity_score INTEGER,
                suspicious_count INTEGER DEFAULT 0,
                warning_count INTEGER DEFAULT 0,
                calibration_json TEXT,
                viewport_json TEXT,
                duration_seconds INTEGER,
                report_json TEXT
            );

            CREATE TABLE IF NOT EXISTS session_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                recorded_at TEXT NOT NULL,
                status TEXT NOT NULL,
                messages_json TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id)
            );

            CREATE INDEX IF NOT EXISTS idx_events_session
                ON session_events(session_id, recorded_at);
            """
        )


@contextmanager
def get_connection() -> Generator[sqlite3.Connection, None, None]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def create_session(
    student_name: str | None = None,
    exam_id: str = "practice-biology",
    calibration: dict[str, Any] | None = None,
) -> dict[str, Any]:
    session_id = str(uuid4())
    created_at = _utc_now()
    calibration_json = json.dumps(calibration) if calibration else None
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO sessions (
                id, student_name, exam_id, status, created_at, calibration_json
            )
            VALUES (?, ?, ?, 'active', ?, ?)
            """,
            (session_id, student_name, exam_id, created_at, calibration_json),
        )
    return {
        "id": session_id,
        "student_name": student_name,
        "exam_id": exam_id,
        "status": "active",
        "created_at": created_at,
        "calibration": calibration,
    }


def add_event(session_id: str, status: str, messages: list[str]) -> dict[str, Any]:
    recorded_at = _utc_now()
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if row is None:
            raise KeyError(session_id)
        conn.execute(
            """
            INSERT INTO session_events (session_id, recorded_at, status, messages_json)
            VALUES (?, ?, ?, ?)
            """,
            (session_id, recorded_at, status, json.dumps(messages)),
        )
    return {"session_id": session_id, "recorded_at": recorded_at, "status": status, "messages": messages}


def save_calibration(session_id: str, calibration: dict[str, Any]) -> None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if row is None:
            raise KeyError(session_id)
        conn.execute(
            "UPDATE sessions SET calibration_json = ? WHERE id = ?",
            (json.dumps(calibration), session_id),
        )


def update_student_name(session_id: str, student_name: str | None) -> None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if row is None:
            raise KeyError(session_id)
        conn.execute(
            "UPDATE sessions SET student_name = ? WHERE id = ?",
            (student_name, session_id),
        )


def submit_session(session_id: str, report: dict[str, Any]) -> dict[str, Any]:
    submitted_at = _utc_now()
    report_json = json.dumps(report)
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, status FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if row is None:
            raise KeyError(session_id)

        conn.execute(
            """
            UPDATE sessions SET
                status = 'submitted',
                submitted_at = ?,
                integrity_score = ?,
                suspicious_count = ?,
                warning_count = ?,
                calibration_json = COALESCE(?, calibration_json),
                viewport_json = ?,
                duration_seconds = ?,
                report_json = ?
            WHERE id = ?
            """,
            (
                submitted_at,
                report.get("integrity_score"),
                report.get("suspicious_count", 0),
                report.get("warning_count", 0),
                json.dumps(report["calibration"]) if report.get("calibration") else None,
                json.dumps(report["viewport"]) if report.get("viewport") else None,
                report.get("duration_seconds"),
                report_json,
                session_id,
            ),
        )
    return get_session(session_id)


def get_session(session_id: str) -> dict[str, Any]:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if row is None:
            raise KeyError(session_id)
        events = conn.execute(
            """
            SELECT recorded_at, status, messages_json
            FROM session_events
            WHERE session_id = ?
            ORDER BY recorded_at ASC
            """,
            (session_id,),
        ).fetchall()

    session = dict(row)
    session["calibration"] = json.loads(session.pop("calibration_json") or "null")
    session["viewport"] = json.loads(session.pop("viewport_json") or "null")
    session["report"] = json.loads(session.pop("report_json") or "null")
    session["events"] = [
        {
            "time": e["recorded_at"],
            "status": e["status"],
            "messages": json.loads(e["messages_json"]),
        }
        for e in events
    ]
    return session


def list_sessions(limit: int = 50) -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, student_name, exam_id, status, created_at, submitted_at,
                   integrity_score, suspicious_count, warning_count, duration_seconds
            FROM sessions
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]
