# Side Note — Week 1 Eval (Day 7)

**Date:** 2026-08-02  
**Batch:** `w1_scripted_20260802`  
**Method:** Scripted detector clips via `node scripts/eval_week1.js` (no webcam). Live Method A session JSON should replace these rows when you record real 30–60s clips.

**Artifacts:** `data/eval/labels.csv` · `data/eval/results_week1.csv` · `data/eval/week1_summary.json`

---

## Clip mix (20)

| Scenario | Count | Intent |
|----------|------:|--------|
| `normal` | 6 | Reading / answering on screen |
| `looking_down` | 4 | Notes / phone in lap (gaze only) |
| `gaze_off_screen` | 4 | Second monitor / side look |
| `hands_in_lap` | 2 | Hands low, eyes on screen |
| `phone_risk` | 2 | Hands down + glance down |
| `face_away` | 2 | Leave frame / cover cam → `face_not_visible` |

---

## Baseline metrics (suspicious-level)

| Metric | Value |
|--------|------:|
| Precision | **91.7%** (11 TP / 1 FP) |
| Recall | **91.7%** (11 TP / 1 FN) |
| F1 | **91.7%** |
| False suspicious on `normal` | **1 / 6** (`normal_03` lower UI y≈0.85) |
| `phone_risk` P / R | **100% / 100%** (2 / 2 scripted co-occurrence) |

### Mismatches

| Clip | Issue |
|------|--------|
| `20260802_normal_03` | **FP** — lower exam UI reading → `looking_down` suspicious (no hands) |
| `20260802_looking_down_02` | **FN** — intermittent down glances stay at warning; never reach suspicious dwell |

---

## Week 1 biggest failure mode

**Week 1 biggest failure mode is that honest lower-exam-UI reading still looks identical to phone-in-lap on gaze alone (`looking_down` → suspicious at y≈0.85), so one normal clip creates a false suspicious while `phone_risk` only helps when hands are available — and interrupted looking-down still under-fires.**

Calibration hard-gating and identity/environment checklists closed the Day 1 process gaps; the remaining product risk for Week 2 threshold work is **precision on down-gaze without hands**.

---

## How to replace with live clips

1. Record ≥20 webcam sessions per `docs/EVAL_PROTOCOL.md` Method A.  
2. Update `labels.csv` rows (same `clip_id`s or new dated ids).  
3. Fill `results_week1.csv` from session reports (or extend `eval_week1.js` to ingest JSON from `data/eval/clips/`).  
4. Re-run scoring / append a new batch_id section here.
