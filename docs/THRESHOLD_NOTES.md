# Side Note — Threshold Notes

Canonical detector / gate constants for the **web demo** (`website/js/`).  
Use this file when retuning; always record **before → after** and the eval tag that justified the change.

**Related:** [`FLAG_TAXONOMY.md`](./FLAG_TAXONOMY.md) · [`EVAL_PROTOCOL.md`](./EVAL_PROTOCOL.md) · [`WEEK1_EVAL.md`](./WEEK1_EVAL.md) · [`BASELINE_NOTES.md`](./BASELINE_NOTES.md)

---

## FREEZE — Week of 2026-08-03 (`week2_tune`)

**Do not change detector / hands thresholds this week without a new labeled eval batch.**

| | |
|--|--|
| **Frozen tag** | `week2_tune` |
| **Frozen files** | `website/js/cheating-detector.js`, `website/js/hand-engine.js` |
| **Locked by** | Scripted eval P **100%** / R **91.7%** / F1 **95.7%**; FP_normal **0/6** |
| **Allowed** | Docs, API, UI, evidence, pilot script, bugfixes that do **not** alter zone/dwell/wrist/`phone_risk` constants |
| **Not allowed** | “Feels too sensitive” / “try 0.89” vibes tweaks; one-off constant edits without `results_*.csv` + before/after row here |
| **Unfreeze when** | New live or scripted batch (≥20 clips) scored under `EVAL_PROTOCOL.md`, then append §5 change-log entry |

Frozen constant snapshot (copy of §4):

```text
LAP_ENTER_Y=0.88  LAP_EXIT_Y=0.80
OFF_ENTER_X=0.025 OFF_EXIT_X=0.08
WARNING_FRAMES=12 SUSPICIOUS_FRAMES=22
DOWN_ALONE_SUSPICIOUS_FRAMES=26
PHONE_WARNING_FRAMES=12 PHONE_SUSPICIOUS_FRAMES=18
HISTORY_LEN=44 CLEAN_FRAMES_TO_RESET=6
ABS_LAP_ENTER_Y=0.58 ABS_LAP_EXIT_Y=0.50
REL_ENTER_FACE_FRAC=0.22 REL_EXIT_FACE_FRAC=0.10
phone_risk = looking_down AND hands_in_lap only
```

**Current commit baseline for these numbers:** Week 2 freeze (`week2_tune`), 2026-08-03.

---

## 1. Week 1 lock — before / after

### 1.1 Gaze zones (`cheating-detector.js`)

| Constant | Before (Day 1 baseline) | After (Week 1 shipped) | Why |
|----------|-------------------------|------------------------|-----|
| `LAP_ENTER_Y` | `0.82` | `0.82` *(unchanged)* | Still the enter line for `looking_down`. Week 1 eval FP on honest UI at `y≈0.85` — **do not raise blindly without hands gating.** |
| `LAP_EXIT_Y` | `0.74` | `0.74` *(unchanged)* | Hysteresis exit; keep ≥0.06 below enter. |
| `OFF_ENTER_X` | `0.03` | `0.03` *(unchanged)* | Left/right edge enter (`x < 0.03` or `x > 0.97`). |
| `OFF_EXIT_X` | `0.06` | `0.06` *(unchanged)* | Exit when gaze returns inside `0.06…0.94`. |

**Week 1 decision:** keep zone geometry; reduce false “phone” meaning via **co-occurrence** (`phone_risk`) rather than moving the lap line yet.

### 1.2 Dwell / history windows (`cheating-detector.js`)

| Constant | Before | After | Why |
|----------|--------|-------|-----|
| `WARNING_FRAMES` | `10` | `10` *(unchanged)* | ~brief sustained anomaly at demo update rate. |
| `SUSPICIOUS_FRAMES` | `20` | `20` *(unchanged)* | ~longer dwell before `suspicious`. |
| `HISTORY_LEN` | `40` | `40` *(unchanged)* | Rolling reason buffer. |
| `CLEAN_FRAMES_TO_RESET` | `8` | `8` *(unchanged)* | Frames of clean gaze before clearing streak. |

**Eval note:** intermittent `looking_down` (clip `looking_down_02`) stayed at **warning** and never hit suspicious — FN for `gt_should_suspicious`. Raising dwell further would worsen that; prefer continuous-behavior labeling or a separate “burst count” rule in Week 2.

### 1.3 Rules that *did* change (behavior, not just numbers)

| Rule | Before (Day 1) | After (Week 1) |
|------|----------------|----------------|
| `phone_risk` | **Absent** on web (gaze-only `looking_down`) | **Emitted** when `looking_down` + `hands.inLap` co-occur; priority **100**; score weight **−12** at suspicious |
| `looking_down` → suspicious without hands | Yes (Run 2 bottom UI → suspicious) | Still possible *(known FP)*; instructor should prefer `phone_risk` when hands available |
| `face_not_visible` | Warning only; never suspicious | Escalates to **suspicious** after `SUSPICIOUS_FRAMES` missing |
| `hands_in_lap` alone | N/A on web | `info` briefly → `warning` when sustained; **not** suspicious alone |
| Flag object shape | Legacy `{ status, messages }` | `{ id, severity, confidence, startedAt, message }` (+ optional `meta`) |

### 1.4 Hands heuristics (`hand-engine.js`) — new in Week 1

| Constant | Before | After | Notes |
|----------|--------|-------|-------|
| Relative enter | — | `REL_ENTER_FACE_FRAC = 0.18` | Wrist below chin by ~18% of face height |
| Relative exit | — | `REL_EXIT_FACE_FRAC = 0.06` | Hysteresis |
| Absolute enter (no face) | — | `ABS_LAP_ENTER_Y = 0.55` | Matches desktop `main.py` `LAP_ZONE_Y` |
| Absolute exit | — | `ABS_LAP_EXIT_Y = 0.48` | Hysteresis |
| Frame gap | — | `FRAME_GAP_MS = 66` | ~15 Hz |

### 1.5 Calibration / session gates (`gaze-engine.js`, `app.js`) — new in Week 1

| Constant / gate | Before | After | Why |
|-----------------|--------|-------|-----|
| Accuracy pass threshold | Soft / optional (~180 mentioned in copy) | **Hard gate** `SIDE_NOTE_ACCURACY_THRESHOLD_PX` default **180** | Failed cal cannot start exam |
| “Continue anyway” | Present | **Removed** | Garbage gaze → garbage flags |
| Student identity | Optional | **Required** (≥2 chars name/email) | Session attribution |
| Environment checklist | Soft tips | **Hard confirm** lighting + distance + fullscreen | Setup quality before calibrate |
| Evidence cap | None | `MAX_ITEMS = 8` | Memory / report size |
| Evidence burst | None | 3 JPEGs @ `0 / 900 / 1800` ms, quality `0.65`, max width `280` | Taxonomy “2–3s burst” |
| Evidence cooldown | — | `COOLDOWN_MS = 4000` | Avoid spam captures |

### 1.6 Integrity score weights (taxonomy-aligned)

| Event | Before (approx.) | After |
|-------|------------------|-------|
| `warning` | −2 style drain | **−2** |
| `suspicious` (non-phone) | −8 | **−8** |
| `suspicious` + `phone_risk` | N/A on web | **−12** |

---

## 2. Week 1 eval snapshot (justifies the lock)

| Metric | Scripted `w1_scripted_20260802` |
|--------|--------------------------------:|
| Suspicious precision | **91.7%** |
| Suspicious recall | **91.7%** |
| F1 | **91.7%** |
| False suspicious on `normal` | **1 / 6** (`normal_03`, lower UI `y≈0.85`) |
| `phone_risk` P / R | **100% / 100%** (2 scripted co-occurrence clips) |

**Biggest failure mode (Week 1):** honest lower-exam-UI reading still indistinguishable from phone-in-lap on **gaze alone**.

Day 10 targets from `EVAL_PROTOCOL.md` (precision ≥0.70, recall ≥0.60, ≤1 false suspicious / 2 min normal) are **met on scripted data** for P/R, but the single normal FP is still the product risk to attack next.

---

## 3. Desktop vs web (do not mix blindly)

| Concept | Desktop `main.py` | Web demo (Week 2) |
|---------|-------------------|-------------------|
| Looking down | Iris offset `GAZE_DOWN_THRESHOLD = 0.02` | Viewport `LAP_ENTER_Y = 0.88` / exit `0.80` |
| Off screen | `GAZE_OFF_SCREEN_THRESHOLD = 0.08` | `OFF_ENTER_X = 0.025` / exit `0.08` |
| Hands lap | `LAP_ZONE_Y = 0.55` | Rel-to-chin `0.22`/`0.10` **or** abs `0.58`/`0.50` |
| Suspicious dwell | `15` frames | `22` general; gaze-only down `26`; `phone_risk` `18` |
| Warning dwell | `8` frames | `12` |

---

## 4. Week 2 tune — shipped 2026-08-03 (`week2_tune`)

| Constant | Before (Week 1) | After (Week 2) | Why |
|----------|----------------:|---------------:|-----|
| `LAP_ENTER_Y` | 0.82 | **0.88** | Exam UI at ~0.85 no longer enters lap zone |
| `LAP_EXIT_Y` | 0.74 | **0.80** | Keep ~0.08 hysteresis |
| `OFF_ENTER_X` | 0.03 | **0.025** | Slightly tighter true edge |
| `OFF_EXIT_X` | 0.06 | **0.08** | Wider exit hysteresis |
| `WARNING_FRAMES` | 10 | **12** | Fewer soft FPs on brief glances |
| `SUSPICIOUS_FRAMES` | 20 | **22** | Off-screen / face long dwell |
| `DOWN_ALONE_SUSPICIOUS_FRAMES` | (=20) | **26** | Gaze-only down needs longer sustain |
| `PHONE_WARNING_FRAMES` | (=10) | **12** | Co-occurrence warning |
| `PHONE_SUSPICIOUS_FRAMES` | (=20) | **18** | `phone_risk` escalates sooner than gaze-only |
| `HISTORY_LEN` | 40 | **44** | Match longer windows |
| `CLEAN_FRAMES_TO_RESET` | 8 | **6** | Faster clear after brief anomaly |
| `ABS_LAP_ENTER_Y` / exit | 0.55 / 0.48 | **0.58 / 0.50** | Stricter wrist-Y fallback |
| `REL_ENTER_FACE_FRAC` / exit | 0.18 / 0.06 | **0.22 / 0.10** | Stricter chin-relative lap |

**phone_risk requirements (unchanged rule, clearer):** emit only when **`looking_down` + `hands_in_lap`** in the same frame history window — never from hands alone.

### Eval after tune (same 20 scripted clips)

| Metric | Week 1 | Week 2 tune |
|--------|-------:|------------:|
| Suspicious precision | 91.7% | **100%** |
| Suspicious recall | 91.7% | **91.7%** |
| F1 | 91.7% | **95.7%** |
| False suspicious on `normal` | 1 / 6 | **0 / 6** |
| `phone_risk` P / R | 100 / 100 | **100 / 100** |

Remaining FN: `looking_down_02` (intermittent bursts → warning only).

Artifacts: `data/eval/results_week1.csv` · `data/eval/week1_summary.json` (tag `week2_tune`).

---

## 5. Change log

| Date | Tag | What changed |
|------|-----|--------------|
| 2026-07-31 | Day 1 | Baseline documented in `BASELINE_NOTES.md` (zones `0.82`/`0.74`, no web `phone_risk`, soft cal gate). |
| 2026-08-02 | Week 1 / `w1_scripted_20260802` | Co-occurrence `phone_risk`, face escalate, hard cal/identity/env gates, evidence caps; zone numbers unchanged. |
| 2026-08-03 | `week2_tune` | Raised lap enter, longer gaze-only down suspicious, faster `phone_risk`, stricter wrist cutoffs — P **100%**, FP_normal **0/6**. |
| 2026-08-03 | **FREEZE** | Thresholds frozen for the week — no vibes-based tweaks; next change requires labeled eval + before/after. |
| 2026-08-03 | Day 14 re-run | Full 20 + 10-clip subset (`day14_subset`) — **no regression**; still P **100%** / R **91.7%** / F1 **95.7%**; FP_normal **0/6**. |

When you retune, append:

```text
### YYYY-MM-DD — <tag>
Constant: NAME
Before: …
After: …
Eval: results_<tag>.csv — P/R/F1 … ; FP_normal …
Notes: …
```