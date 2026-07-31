# Side Note — Baseline Notes (Day 1)

**Date:** 2026-07-31  
**Commit context:** current `main` (pre–Day 2 detector refactor)  
**Purpose:** Capture top failure modes from exercising the current demo **3×** before changing thresholds or adding MediaPipe.

---

## How the 3 runs were done

### Live UI (browser)

- Server: `python run_server.py` → `http://localhost:8000/demo.html`
- Opened the demo; camera permission granted; `<video>` stream active (640×480).
- **WebGazer `start()` failed** with `TypeError: t is not a function` (inside `js/webgazer.js`). Button reset to “Allow camera & continue”; wizard never left Welcome.
- So full click-calibrate-exam loops were **blocked in this agent browser**. Treat that as an observed product failure mode (#4), not as “demo untested.”

### Scripted detector runs (same rules as production web JS)

Reproducible stand-in for three exam monitor sessions via `scripts/baseline_probe.js` (loads `website/js/cheating-detector.js` with a 1440×900 viewport):

| Run | Script | Intent | Outcome |
|-----|--------|--------|---------|
| **1** | `run1_normal_center` | 60 frames gaze at center (0.5, 0.45) | Score **100**, 0 warnings, 0 suspicious ✅ |
| **2** | `run2_bottom_of_exam_ui` | Look at lower exam area `y≈0.85` for ~25 frames | **Warning → suspicious** (“phone or notes”) — false flag for normal reading |
| **3** | `run3_side_glances` | Brief left edge (~12 frames) then sustained (~22) | Brief → warning only; sustained → **suspicious** (expected for long look; brief still logged a warning) |

Extra probes (same session): gaze-only “phone in lap” only emits `looking_down` (no `phone_risk`); face missing → **warning only**, never suspicious.

---

## Top 5 failure modes

### 1. False suspicious when looking at the bottom of the exam UI

| | |
|--|--|
| **Type** | False flag (`looking_down` → suspicious) |
| **Evidence** | Run 2: `y_norm = 0.85` for ~20 frames → suspicious message about phone/notes |
| **Why** | Lap zone enter is `y > 0.82`. Real exam content (Q2/Q3, submit, lower sidebar) lives in that band. |
| **Impact** | Honest students reading lower questions get scored like phone use. Kills instructor trust. |
| **Fix direction** | Raise enter threshold / require longer dwell; exclude “content band”; add hands co-occurrence before suspicious (see #2). |

### 2. Missed phone risk — web has no hands / `phone_risk`

| | |
|--|--|
| **Type** | Missed / undifferentiated detection |
| **Evidence** | `probe_phone_in_lap_gaze_only` → only `looking_down`. `phone_risk` exists in `main.py`, **not** in `cheating-detector.js`. |
| **Why** | Browser stack is gaze-zones only; MediaPipe Hands not wired. |
| **Impact** | Cannot separate “reading bottom of page” from “phone in lap.” Taxonomy already defines `phone_risk` as the high-value signal. |
| **Fix direction** | Day 4: Hands in browser + co-occurrence rule from `FLAG_TAXONOMY.md`. |

### 3. Failed / weak calibration still allowed into a scored exam

| | |
|--|--|
| **Type** | Calibration gate failure (process) |
| **Evidence** | UI copy: “Accuracy check **(optional)**”. In `app.js`, failed validation / `noTracking` / high error still sets `btnStartExam.disabled = false`. Calibration can be saved when `sessionId` is still null. |
| **Why** | Demo optimizes for completion, not signal quality. |
| **Impact** | Garbage gaze → garbage flags → meaningless integrity score. Worst possible “sellable” demo. |
| **Fix direction** | Day 6: hard block exam unless accuracy passes; persist calibration on a real session. |

### 4. WebGazer start / tracking fragility

| | |
|--|--|
| **Type** | Calibration / tracker fail (runtime) |
| **Evidence** | Live demo 2026-07-31: camera OK, then `SideNoteGaze.start` → `TypeError: t is not a function` in vendored WebGazer. SETUP.md already lists lighting, posture, and Safari issues as common breakages. |
| **Why** | Heavy dependency on WebGazer + environment; init path is brittle across embeds/browsers. |
| **Impact** | Session never starts, or starts with unusable gaze → either drop-off or silent bad data. |
| **Fix direction** | Harden begin/listener contract; clearer error UI; Day 3+ MediaPipe face as independent presence signal so “camera works” ≠ “only WebGazer works.” |

### 5. Face-not-visible under-called (and gaze presence is weak)

| | |
|--|--|
| **Type** | Missed / soft under-flag |
| **Evidence** | `probe_face_missing`: sustained null gaze → **warning only**, score 98. No escalation to suspicious. Face visibility in exam relies on WebGazer prediction timing (`isFaceVisible`), not a dedicated face model. |
| **Why** | Taxonomy allows long absence → suspicious; code never escalates. Leaving the chair looks almost “clean.” |
| **Impact** | Easy evasion: walk away or cover cam after a “good” moment. |
| **Fix direction** | Escalate long `face_not_visible` to suspicious; Day 3 MediaPipe Face Mesh for reliable presence. |

---

## Honorable mentions (not top 5, still track)

- **Brief edge glances** still create warning events (Run 3) — noisy logs for instructors even when severity is correct for sustained looks.
- **No evidence frames** on suspicious — instructor only gets text messages (Day 5).
- **Desktop vs web drift** — two detectors; pilots on web won’t see desktop `phone_risk` behavior.

---

## Week 1 biggest failure mode (one line)

**Bottom-of-screen exam reading is indistinguishable from phone-in-lap, and the demo lets bad calibration produce a scored report anyway.**

---

## Next measurements

- Day 7: ≥20 labeled clips per `EVAL_PROTOCOL.md` → `data/eval/results_week1.csv`
- Re-run `node scripts/baseline_probe.js` after Day 2–4 detector changes; expect Run 2 to stop reaching suspicious without hands, and `phone_risk` to appear when both signals fire.
