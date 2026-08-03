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

# Bump when adding columns / tables. init_db() migrates existing files in place.
SCHEMA_VERSION = 2

# Columns added after the original CREATE (migration-safe ALTER TABLE).
# Fresh installs get these from CREATE; existing DBs get ADD COLUMN if missing.
_SESSION_EVENT_COLUMNS: tuple[tuple[str, str], ...] = (
    ("flag_id", "TEXT"),
    ("severity", "TEXT"),
    ("confidence", "REAL"),
    ("evidence_path", "TEXT"),
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return {r["name"] if isinstance(r, sqlite3.Row) else r[1] for r in rows}


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, sql_type: str) -> bool:
    """ADD COLUMN if missing. Returns True when a column was added."""
    if column in _table_columns(conn, table):
        return False
    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {sql_type}")
    return True


def _get_schema_version(conn: sqlite3.Connection) -> int:
    row = conn.execute(
        "SELECT version FROM schema_meta WHERE id = 1"
    ).fetchone()
    if row is None:
        return 0
    return int(row["version"] if isinstance(row, sqlite3.Row) else row[0])


def _set_schema_version(conn: sqlite3.Connection, version: int) -> None:
    conn.execute(
        """
        INSERT INTO schema_meta (id, version, updated_at)
        VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            version = excluded.version,
            updated_at = excluded.updated_at
        """,
        (version, _utc_now()),
    )


def migrate_db(conn: sqlite3.Connection) -> dict[str, Any]:
    """
    Apply pending migrations to an open connection.

    Safe on existing data/sidenote.db: uses ALTER TABLE ADD COLUMN only
    (never DROP). New installs create the full v2 DDL up front.
    """
    added: list[str] = []
    for column, sql_type in _SESSION_EVENT_COLUMNS:
        if _ensure_column(conn, "session_events", column, sql_type):
            added.append(f"session_events.{column}")

    previous = _get_schema_version(conn)
    if previous < SCHEMA_VERSION or added:
        _set_schema_version(conn, SCHEMA_VERSION)

    return {
        "schema_version": SCHEMA_VERSION,
        "previous_version": previous,
        "columns_added": added,
    }


def init_db() -> dict[str, Any]:
    """
    Create tables if needed, then migrate to SCHEMA_VERSION.

    Version note: SCHEMA_VERSION=2 adds flag_id, severity, confidence,
    evidence_path on session_events. Existing rows keep NULL for new fields.
    Recreate only if you intentionally wipe local demo data:
        rm data/sidenote.db && python -c 'from backend.database import init_db; init_db()'
    """
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with get_connection() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS schema_meta (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                version INTEGER NOT NULL,
                updated_at TEXT NOT NULL
            );

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
                flag_id TEXT,
                severity TEXT,
                confidence REAL,
                evidence_path TEXT,
                FOREIGN KEY (session_id) REFERENCES sessions(id)
            );

            CREATE INDEX IF NOT EXISTS idx_events_session
                ON session_events(session_id, recorded_at);
            """
        )
        # Older DBs created session_events without the new columns — ALTER safely.
        info = migrate_db(conn)
    return info


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


def add_event(
    session_id: str,
    status: str,
    messages: list[str],
    *,
    flag_id: str | None = None,
    severity: str | None = None,
    confidence: float | None = None,
    evidence_path: str | None = None,
) -> dict[str, Any]:
    recorded_at = _utc_now()
    # Legacy clients send status only — mirror into severity when omitted.
    resolved_severity = severity or status
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if row is None:
            raise KeyError(session_id)
        conn.execute(
            """
            INSERT INTO session_events (
                session_id, recorded_at, status, messages_json,
                flag_id, severity, confidence, evidence_path
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                session_id,
                recorded_at,
                status,
                json.dumps(messages),
                flag_id,
                resolved_severity,
                confidence,
                evidence_path,
            ),
        )
    return {
        "session_id": session_id,
        "recorded_at": recorded_at,
        "status": status,
        "messages": messages,
        "flag_id": flag_id,
        "severity": resolved_severity,
        "confidence": confidence,
        "evidence_path": evidence_path,
    }


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
            SELECT recorded_at, status, messages_json,
                   flag_id, severity, confidence, evidence_path
            FROM session_events
            WHERE session_id = ?
            ORDER BY recorded_at ASC, id ASC
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
            "flag_id": e["flag_id"],
            "severity": e["severity"] or e["status"],
            "confidence": e["confidence"],
            "evidence_path": e["evidence_path"],
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
