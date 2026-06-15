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

## Desktop app (separate)

Hand + iris detection without the web API:

```bash
python main.py
```
