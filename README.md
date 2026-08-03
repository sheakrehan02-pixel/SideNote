# Side Note

Soft proctoring demo: gaze + hands signals for instructors to **review**, not automatic cheating verdicts.

**Primary path:** Chrome/Edge → `http://localhost:8000/demo.html`

---

## How to run

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python run_server.py
```

| URL | Purpose |
|-----|---------|
| http://localhost:8000/demo.html | Student exam + live integrity signals |
| http://localhost:8000/sessions.html | Instructor session list |
| http://localhost:8000/api/health | Backend health |

**Browser:** Chrome or Edge (recommended). Safari secondary. Firefox not supported. Details: [`docs/SUPPORTED_BROWSERS.md`](docs/SUPPORTED_BROWSERS.md).

**Every session:** front lighting, arm’s length, maximized window, allow camera. Full checklist: [`website/SETUP.md`](website/SETUP.md).

**Pilot walkthrough (~10 min):** [`docs/PILOT_SCRIPT.md`](docs/PILOT_SCRIPT.md).

### Optional

| Command | What |
|---------|------|
| `python main.py` | Desktop OpenCV / MediaPipe app (`q` to quit) |
| `cd website && python3 -m http.server 8000` | Static-only demo (tracking works; **sessions not saved**) |
| `node scripts/eval_week1.js` | Full 20-clip scripted eval |
| `node scripts/eval_week1.js --subset` | Day 14 10-clip regression check |

---

## What’s new (2-week MVP)

- **Soft labels** — UI uses *Integrity signal* / *Needs review* / *Clear* (not “caught cheating”)
- **Named flags** — `looking_down`, `gaze_off_screen`, `hands_in_lap`, `phone_risk`, `face_not_visible` with dwell + evidence
- **`phone_risk`** — only when looking down **and** hands in lap (highest-weight signal)
- **Gates** — identity, environment checklist, hard calibration pass before exam start
- **Resilience** — camera-loss pause, offline “session not saved” banner, tab-blur soft info (gaze paused while hidden)
- **Instructor review** — session report, score weight explanation, evidence gallery
- **Frozen thresholds** — tag `week2_tune` zones + `accuracy_v1` gaze/head-pose upgrades (2026-08-03): scripted suspicious **P 100% / R 91.7% / F1 95.7%**; false suspicious on normal **0/6**. See [`docs/THRESHOLD_NOTES.md`](docs/THRESHOLD_NOTES.md) · [`docs/WEEK1_EVAL.md`](docs/WEEK1_EVAL.md)

---

## Known limits

- **Not a verdict** — signals need human review; score is a weighted hint, not pass/fail
- **Environment-sensitive** — backlighting, head motion, small windows, and poor calibration drive false or missed flags
- **Scripted eval ≠ live classroom** — freeze metrics are from `eval_week1.js` clips; real webcam batches will differ
- **Known miss** — intermittent down-glances (`looking_down_02`) can stay at warning and never hit suspicious
- **Hands / phone** — MediaPipe wrist heuristics; no phone object detector
- **Browsers** — Chrome/Edge first; Safari less reliable for calibration; Firefox unsupported
- **Offline** — demo can run without the API, but sessions are not persisted
- **Threshold freeze** — do not retune zone/dwell/wrist/`phone_risk` constants without a new labeled eval batch

---

## Docs map

| Doc | Topic |
|-----|--------|
| [`website/SETUP.md`](website/SETUP.md) | Calibration & demo wizard |
| [`docs/PILOT_SCRIPT.md`](docs/PILOT_SCRIPT.md) | Live demo script |
| [`docs/FLAG_TAXONOMY.md`](docs/FLAG_TAXONOMY.md) | Flag meanings & severities |
| [`docs/THRESHOLD_NOTES.md`](docs/THRESHOLD_NOTES.md) | Frozen constants + change log |
| [`docs/EVAL_PROTOCOL.md`](docs/EVAL_PROTOCOL.md) | How we score precision/recall |
| [`docs/SUPPORTED_BROWSERS.md`](docs/SUPPORTED_BROWSERS.md) | Browser smoke results |
| [`docs/WEEK3_BACKLOG.md`](docs/WEEK3_BACKLOG.md) | Next: auth, Postgres, evidence on disk, first pilot |
| [`backend/README.md`](backend/README.md) | API + SQLite |
| [`docs/TRAINING_RESOURCES.md`](docs/TRAINING_RESOURCES.md) | Datasets / ML ideas |
