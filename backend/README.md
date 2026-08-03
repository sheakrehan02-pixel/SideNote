# Side Note Backend

FastAPI server for proctoring session storage. Serves the website and API on one port.

## Run

From the **project root** (not `website/`):

```bash
pip install -r requirements.txt
python run_server.py
```

Open:

| URL | Purpose |
|-----|---------|
| http://localhost:8000/demo.html | Student proctoring demo |
| http://localhost:8000/sessions.html | Instructor session list |
| http://localhost:8000/session.html?id=&lt;uuid&gt; | Instructor session detail |
| http://localhost:8000/api/health | Health check |
| http://localhost:8000/api/sessions | List sessions (JSON) |

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Service status |
| POST | `/api/sessions` | Start a new exam session |
| POST | `/api/sessions/{id}/calibration` | Save calibration metrics |
| POST | `/api/sessions/{id}/events` | Log warning/suspicious event |
| POST | `/api/sessions/{id}/submit` | Submit final report |
| GET | `/api/sessions/{id}` | Full session + events |
| GET | `/api/sessions` | List recent sessions |

Data is stored in `data/sidenote.db` (SQLite, gitignored).

### Schema version

`SCHEMA_VERSION` lives in `backend/database.py` (currently **2**).

| Version | Change |
|--------:|--------|
| 1 | Original `sessions` + `session_events(status, messages_json)` |
| 2 | `session_events`: `flag_id`, `severity`, `confidence`, `evidence_path` |

On startup, `init_db()` creates missing tables and runs **migration-safe** `ALTER TABLE … ADD COLUMN` for any new fields. Existing rows keep `NULL` for new columns — no wipe required.

To force a clean local DB (destroys demo sessions):

```bash
rm data/sidenote.db
python -c "from backend.database import init_db; print(init_db())"
```

## Desktop app (separate)

Hand + iris detection without the web API:

```bash
python main.py
```
