# Side Note — Eye Tracking & Proctoring

Real-time eye tracking and exam integrity monitoring. **Web demo** (WebGazer + FastAPI backend) and **desktop app** (MediaPipe + OpenCV).

## Quick start (web + backend)

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python run_server.py
```

| URL | Purpose |
|-----|---------|
| http://localhost:8000/demo.html | Proctoring demo |
| http://localhost:8000/sessions.html | View saved sessions |
| http://localhost:8000/api/health | API status |

See **`backend/README.md`** and **`website/SETUP.md`** for full docs.

## Desktop app (hands + iris)

```bash
pip install -r requirements.txt
python main.py
```

Press `q` to quit.

## Features

- **Web:** 9-point calibration, gaze tracking, integrity flags, session storage
- **Desktop:** Iris gaze, hand-in-lap detection, phone-risk heuristics
- **Backend:** FastAPI + SQLite — sessions, events, reports

## Training

See **[docs/TRAINING_RESOURCES.md](docs/TRAINING_RESOURCES.md)** for datasets and ML pipeline ideas.

