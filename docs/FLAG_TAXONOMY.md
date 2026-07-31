# Side Note — Flag Taxonomy

Canonical definitions for integrity signals. Use these `flag_id` values in detectors, APIs, session reports, and instructor UI.

**Product rule:** Flags are **signals for human review**, not verdicts of cheating.

**Severity ladder**

| Severity | Meaning | Typical instructor action |
|----------|---------|---------------------------|
| `info` | Context only; not scored harshly | Ignore unless pattern emerges |
| `warning` | Brief / ambiguous anomaly | Glance at timestamp |
| `suspicious` | Sustained or high-risk pattern | Open evidence and decide |

When the same behavior escalates over time, emit **one** `flag_id` that upgrades severity (do not invent parallel IDs like `looking_down_warn` / `looking_down_sus`).

---

## Flag catalog

### `looking_down`

| Field | Value |
|-------|--------|
| **Instructor label** | Looking down (desk / lap) |
| **Student message (warning)** | Glanced toward the bottom of the screen |
| **Student message (suspicious)** | Looking down for a while — phone or notes nearby? |
| **Severity** | `warning` after brief sustained look; `suspicious` after longer sustained look |
| **Trigger** | Gaze Y (viewport-normalized) enters the bottom zone and stays there. Web defaults: enter `y > 0.82`, exit `y < 0.74` (hysteresis). Escalate using frame windows (~10 warning / ~20 suspicious at demo FPS). |
| **Signals** | WebGazer screen gaze (primary). Optional: head pitch down from Face Mesh as supporting confidence. |
| **Evidence required** | **Yes** at `suspicious`: ≥1 webcam frame (prefer 2–3s burst) + timestamp + gaze `(x,y)` sample. Warning: timestamp + reason only is enough. |
| **Confidence notes** | Lower if calibration failed or avg error is high. Do not emit `suspicious` if calibration `passed === false`. |
| **Status** | Implemented (web + desktop) |

---

### `gaze_off_screen`

| Field | Value |
|-------|--------|
| **Instructor label** | Gaze off-screen (side) |
| **Student message (warning)** | Glanced toward the edge of the screen |
| **Student message (suspicious)** | Gaze off to the side for a while — second screen or device? |
| **Severity** | `warning` → `suspicious` with duration |
| **Trigger** | Gaze X near left/right viewport edges. Web defaults: enter `x < 0.03` or `x > 0.97`, exit inside `0.06…0.94`. Same frame windows as `looking_down`. |
| **Signals** | WebGazer screen gaze |
| **Evidence required** | **Yes** at `suspicious`: frame(s) + timestamp + gaze sample. Warning: log only. |
| **Confidence notes** | Easy false positive if calibration drifts or student sits off-center. Prefer longer duration before `suspicious`. |
| **Status** | Implemented (web + desktop) |

---

### `face_not_visible`

| Field | Value |
|-------|--------|
| **Instructor label** | Face not visible |
| **Student message** | Cannot see your face — check camera angle and lighting |
| **Severity** | `warning` when sustained; escalate to `suspicious` only if face stays missing for a long stretch (e.g. >> warning window) or repeatedly |
| **Trigger** | No usable face in the webcam frame (WebGazer face missing today; MediaPipe Face Mesh preferred). Brief blinks/occlusion must not fire. |
| **Signals** | Face Mesh presence (target); WebGazer face flag (current) |
| **Evidence required** | **Yes** when severity ≥ `warning` for >~3s: last good frame optional + current empty/obscured frame + timestamp. |
| **Confidence notes** | Lighting and extreme pose cause false positives — prefer MediaPipe over WebGazer alone. |
| **Status** | Implemented (web + desktop); MediaPipe upgrade planned Day 3 |

---

### `hands_in_lap`

| Field | Value |
|-------|--------|
| **Instructor label** | Hands low / in lap zone |
| **Student message (warning)** | Hands appear below the desk line |
| **Student message (info)** | Hands briefly left the keyboard area |
| **Severity** | `info` for fleeting detection; `warning` when sustained. Alone, rarely `suspicious` — prefer pairing into `phone_risk`. |
| **Trigger** | ≥1 detected hand with wrist Y below a chin/torso-relative threshold (desktop: normalized Y ≳ 0.55). Require N consecutive frames before `warning`. |
| **Signals** | MediaPipe Hands (desktop today; browser Day 4) |
| **Evidence required** | **Yes** at `warning+`: frame showing hand landmarks or hand region + timestamp. |
| **Confidence notes** | False positives when resting elbows / stretching. Do not score heavily in isolation. |
| **Status** | Desktop only (`hand_in_lap` / `both_hands_lap` in `main.py`); unify to this id in browser |

**ID rule:** Use `hands_in_lap` only. Encode one vs two hands in event metadata (`hand_count: 1|2`), not separate flag IDs.

---

### `phone_risk`

| Field | Value |
|-------|--------|
| **Instructor label** | Possible phone / notes in lap |
| **Student message (warning)** | Looking down with hands low — keep eyes on the exam |
| **Student message (suspicious)** | Sustained look down with hands in lap — possible phone or notes |
| **Severity** | Starts at `warning`; becomes `suspicious` when co-occurrence is sustained |
| **Trigger** | **Co-occurrence:** `looking_down` **and** `hands_in_lap` active in the same temporal window. Highest-priority integrity signal in v1. |
| **Signals** | Gaze (WebGazer) + Hands (MediaPipe) |
| **Evidence required** | **Always** when emitted at `warning` or higher: 2–3s burst or ≥2 frames spanning the window + timestamps + both contributing flag ids. |
| **Confidence notes** | Highest weight in integrity score. Still a signal — instructor decides. |
| **Status** | Desktop only; browser target Day 4 |

---

### `multiple_faces` *(stretch — after Day 4 if ahead)*

| Field | Value |
|-------|--------|
| **Instructor label** | Multiple faces in frame |
| **Student message** | More than one person appears on camera |
| **Severity** | `warning` on first sustained detection; `suspicious` if persistent |
| **Trigger** | Face Mesh / detector reports ≥2 distinct faces for N frames |
| **Signals** | MediaPipe Face Detection or Face Mesh multi-face |
| **Evidence required** | **Yes**: frame clearly showing multiple faces + timestamp |
| **Status** | Not implemented — optional stretch |

---

## Severity & scoring policy (v1)

Use one score formula everywhere (client report + server recompute):

| Severity | Default score impact (per logged event) | Notes |
|----------|----------------------------------------|--------|
| `info` | 0 | Logged for context |
| `warning` | −2 | Cap cumulative warning drain if needed later |
| `suspicious` | −8 | Standard |
| `suspicious` + `phone_risk` | −12 | Higher weight for co-occurrence |

Floor score at `0`. Do not treat raw score as a pass/fail grade without an instructor threshold.

**Priority when multiple flags fire in one frame** (for UI “current signal”):

1. `phone_risk`
2. `looking_down` or `gaze_off_screen` (whichever more sustained)
3. `face_not_visible`
4. `hands_in_lap`
5. `multiple_faces`

---

## Event shape (target API / report JSON)

Every logged non-`ok` event should eventually look like:

```json
{
  "flag_id": "phone_risk",
  "severity": "suspicious",
  "confidence": 0.78,
  "instructor_label": "Possible phone / notes in lap",
  "message": "Sustained look down with hands in lap — possible phone or notes",
  "started_at": "2026-07-31T08:12:01.000Z",
  "ended_at": "2026-07-31T08:12:08.000Z",
  "evidence_required": true,
  "evidence": [
    {
      "type": "frame",
      "captured_at": "2026-07-31T08:12:04.000Z",
      "image_data_url": "data:image/jpeg;base64,..."
    }
  ],
  "meta": {
    "contributing_flags": ["looking_down", "hands_in_lap"],
    "hand_count": 1,
    "gaze": { "x_norm": 0.48, "y_norm": 0.91 },
    "calibration_avg_error_px": 120
  }
}
```

Until Day 8, the web client may still send legacy `{ status, messages }`. Map messages → `flag_id` during the backend upgrade.

---

## Evidence rules (summary)

| Flag | Warning | Suspicious |
|------|---------|------------|
| `looking_down` | Log only | Frame(s) + gaze |
| `gaze_off_screen` | Log only | Frame(s) + gaze |
| `face_not_visible` | Frame if >~3s | Frame(s) |
| `hands_in_lap` | Frame | Frame (rare alone) |
| `phone_risk` | Frame burst | Frame burst (required) |
| `multiple_faces` | Frame | Frame |

**Storage cap (Day 5):** max **8** evidence items per session; prefer keeping `phone_risk` and latest `suspicious` over older warnings.

---

## Calibration gate

No `suspicious` integrity conclusion should be trusted when:

- accuracy check failed, or
- `avg_error_px` above the configured threshold (demo default ~180px)

Failed calibration → block exam start (Day 6). If an exam somehow submits anyway, mark session `calibration_failed` and show instructor banner: “Gaze signals unreliable.”

---

## Legacy → canonical ID map

| Existing string / desktop reason | Canonical `flag_id` |
|----------------------------------|---------------------|
| `looking_down` | `looking_down` |
| `gaze_off_screen` | `gaze_off_screen` |
| `face_not_visible` | `face_not_visible` |
| `hand_in_lap` | `hands_in_lap` (`meta.hand_count: 1`) |
| `both_hands_lap` | `hands_in_lap` (`meta.hand_count: 2`) |
| `phone_risk` | `phone_risk` |

---

## Out of scope for v1 (do not invent flags yet)

- Audio / talking detection  
- Tab-switch / copy-paste as primary cheating proof (optional soft `info` later)  
- Eyewear / identity mismatch  
- “Definitely cheating” or legal verdict labels  

---

## Ownership

| Area | Source of truth |
|------|-----------------|
| This taxonomy | `docs/FLAG_TAXONOMY.md` |
| Web rules today | `website/js/cheating-detector.js` |
| Desktop rules today | `main.py` |
| Eval labels | `docs/EVAL_PROTOCOL.md` + `data/eval/` *(Day 1 next)* |

When code and this doc disagree, **update the doc in the same change** or fix the code — do not leave drift.
