# Side Note — Evaluation Protocol

How we measure flagging quality. Without this, threshold tweaks are vibes.

**Goal:** Raise **precision** on `suspicious` / `phone_risk` (instructors trust alerts) while keeping reasonable **recall** on real suspicious behavior. False alarms hurt the product more than occasional misses in soft proctoring.

**Related:** [`FLAG_TAXONOMY.md`](./FLAG_TAXONOMY.md) · clips & CSVs live under `data/eval/`

---

## 1. What we evaluate

We score the **detector’s emitted flags** against **human ground-truth labels** on short scripted sessions.

| Layer | In scope? | Notes |
|-------|-----------|--------|
| Named `flag_id` at severity ≥ `warning` | Yes | Primary |
| Severity tier (`warning` vs `suspicious`) | Yes | Separate metrics |
| Integrity score number | Secondary | Track trend only |
| Gaze pixel accuracy (calibration) | Separate | Gate exams; not cheating precision |
| Evidence image quality | Manual checklist | Day 5+ |

**Primary decision metric (Week 1–2):** precision of events with `severity === "suspicious"` (especially `phone_risk`).

**Secondary:** recall of ground-truth suspicious behaviors; false `suspicious` rate on `normal` clips.

---

## 2. Environment (keep constant within a batch)

Record every clip in a batch under the **same** physical setup:

| Check | Target |
|-------|--------|
| Browser | Chrome (preferred) or Edge |
| Window | Maximized; same resolution for the batch |
| Distance | ~50–70 cm, arm’s length |
| Lighting | Face lit from the front; no strong backlight |
| Camera | Built-in laptop webcam at eye level |
| Glasses | Same as you normally use (note in CSV) |
| Calibration | Complete 9-point + **pass** accuracy check before each clip (or once per batch if posture unchanged — note which) |

If lighting/posture changes mid-batch, start a new `batch_id`.

**Out of scope for Day 7 baseline:** multi-person rooms, outdoor light, ultrawide exotic layouts. Add those later as stress sets.

---

## 3. How to record clips

### 3.1 Clip definition

One **clip** = one continuous demo exam segment, **30–60 seconds**, with a single intended primary behavior (see scenarios below).

### 3.2 Capture method (pick one and stick to it for the batch)

**Method A — Session JSON (preferred for scoring)**  
1. Start backend + `demo.html`.  
2. Calibrate and pass accuracy.  
3. Enter exam; perform the scripted behavior.  
4. Submit; download / save the session report JSON.  
5. Store as `data/eval/clips/<clip_id>.json` (or copy from DB export).  
6. Optional: screen-record the Integrity panel for debugging (not required for metrics).

**Method B — Behavior video (for labeling when JSON is incomplete)**  
1. Phone or OBS records the student (face + hands visible).  
2. Note wall-clock start or use audio clap sync.  
3. Save `data/eval/raw/<clip_id>.mp4`.  
4. Still run the demo so flags exist; attach `session_id` in the CSV.

Minimum for Day 7: **Method A for every clip**. Add Method B when debugging false positives.

### 3.3 Naming

```text
clip_id = YYYYMMDD_<scenario>_<nn>
```

Examples: `20260731_normal_01`, `20260731_looking_down_03`, `20260731_phone_risk_02`

### 3.4 Scenario scripts (ground-truth intent)

Perform the labeled behavior **clearly** for most of the clip. Brief natural glances are OK on `normal` only.

| Scenario / intended label | What to do | Count (Day 7 min) |
|---------------------------|------------|-------------------|
| `normal` | Eyes on exam UI; hands on keyboard/trackpad; answer calmly | 6 |
| `looking_down` | Hold notes or phone in lap; look down repeatedly ≥8–10s total sustained | 4 |
| `gaze_off_screen` | Look at a second monitor or far left/right ≥8–10s sustained | 4 |
| `hands_in_lap` | Hands rest in lap; eyes mostly on screen (isolates hand signal) | 2 |
| `phone_risk` | Look down **and** hands in lap together ≥8–10s | 4 |
| `face_away` | Leave frame, cover camera, or turn away ≥5s | 2 |

**Day 7 floor: ≥20 clips.** Prefer quality and clear labels over volume.

Do **not** mix two intentional cheating behaviors in one clip (e.g. down + off-screen). That breaks per-flag recall.

---

## 4. How to label

### 4.1 Files

| File | Role |
|------|------|
| `data/eval/labels.csv` | Ground truth (human) |
| `data/eval/results_<tag>.csv` | Detector output vs labels (filled after each eval run) |
| `data/eval/clips/` | Session JSON / exports |
| `data/eval/raw/` | Optional videos |

### 4.2 `labels.csv` schema

```csv
clip_id,batch_id,scenario,duration_s,gt_primary_flag,gt_should_suspicious,gt_secondary_flags,cal_avg_error_px,cal_passed,notes
20260731_normal_01,b1,normal,45,none,0,,132,1,calm answering
20260731_looking_down_02,b1,looking_down,50,looking_down,1,,145,1,phone in lap eyes down
```

| Column | Meaning |
|--------|---------|
| `clip_id` | Matches filename / session note |
| `batch_id` | Shared setup group (`b1`, `b2`, …) |
| `scenario` | Script name from §3.4 |
| `duration_s` | Clip length |
| `gt_primary_flag` | Canonical `flag_id` that **should** fire, or `none` for `normal` |
| `gt_should_suspicious` | `1` if a human reviewer would want a **suspicious** (or `phone_risk` suspicious) alert; `0` otherwise |
| `gt_secondary_flags` | Optional pipe-separated ids that may also appear (`hands_in_lap` during `phone_risk`) |
| `cal_avg_error_px` | From accuracy check |
| `cal_passed` | `1` / `0` |
| `notes` | Free text |

**Labeling rules**

1. Label from **behavior you performed**, not from what the UI showed (don’t teach the labels to match a buggy detector).  
2. `gt_should_suspicious = 1` only if the behavior was sustained enough that an instructor should review — match taxonomy duration intent (~suspicious window), not a 1-second glance.  
3. For `normal`, `gt_primary_flag = none` and `gt_should_suspicious = 0`.  
4. For `phone_risk` scenarios, `gt_primary_flag = phone_risk` (not only `looking_down`).  
5. If calibration failed, still label behavior, but **exclude** the clip from gaze-heavy metrics (mark `cal_passed=0` and skip in primary tables).

### 4.3 Filling `results_*.csv` after a run

After each clip, from the session report / event log, record:

```csv
clip_id,pred_any_warning,pred_any_suspicious,pred_flag_ids,pred_top_severity,pred_phone_risk,pred_suspicious_count,pred_warning_count,integrity_score,match_primary,match_suspicious,false_suspicious,notes
```

| Column | How to set |
|--------|------------|
| `pred_flag_ids` | Unique `flag_id`s seen (pipe-separated). Until detector emits ids, map messages → ids using taxonomy legacy map. |
| `pred_phone_risk` | `1` if `phone_risk` appeared at any severity |
| `match_primary` | `1` if `gt_primary_flag` is `none` and no suspicious, **or** `gt_primary_flag` ∈ `pred_flag_ids` (at warning+) |
| `match_suspicious` | `1` if `gt_should_suspicious == pred_any_suspicious` |
| `false_suspicious` | `1` if `pred_any_suspicious=1` and `gt_should_suspicious=0` |

Map legacy messages → ids (until Day 2+):

| Message contains | `flag_id` |
|------------------|-----------|
| Looking down / Glanced toward the bottom | `looking_down` |
| off to the side / edge of the screen | `gaze_off_screen` |
| Cannot see your face / Face not | `face_not_visible` |
| hands in lap / phone | `hands_in_lap` or `phone_risk` (prefer `phone_risk` if both down + hands) |

---

## 5. Scoring precision / recall

Evaluate at two levels. Use clip-level counts first (simplest, Day 7). Event-level is optional later.

### 5.1 Suspicious-level (primary)

Treat each clip as one binary decision: **did we emit any `suspicious`?**

| | `gt_should_suspicious = 1` | `gt_should_suspicious = 0` |
|--|----------------------------|----------------------------|
| **Predicted suspicious** | TP | FP |
| **Not predicted suspicious** | FN | TN |

```text
Precision = TP / (TP + FP)
Recall    = TP / (TP + FN)
F1        = 2 * Precision * Recall / (Precision + Recall)
```

**Also report:**  
`FP_normal =` false suspicious count on clips where `scenario == normal`  
`FP_rate_normal ≈` false suspicious per minute on normal clips only.

### 5.2 Flag-id level (secondary)

For a given `flag_id` (e.g. `looking_down`):

- **TP:** `gt_primary_flag == flag_id` and that id ∈ predictions (severity ≥ `warning`)  
- **FN:** ground truth primary is that id, but id missing from predictions  
- **FP:** id predicted, but `gt_primary_flag` is not that id **and** id not listed in `gt_secondary_flags`

```text
Precision_flag = TP / (TP + FP)
Recall_flag    = TP / (TP + FN)
```

Compute separately for: `looking_down`, `gaze_off_screen`, `face_not_visible`, `hands_in_lap`, `phone_risk`.

**`phone_risk` special case:** if scenario is `phone_risk` and we only fire `looking_down` (no hands), count as **FN** for `phone_risk` (and optionally TP for `looking_down` if that was secondary-acceptable — by default still FN for primary).

### 5.3 Severity agreement

Among clips with `gt_should_suspicious = 1` and primary flag detected:

- **Exact:** predicted top severity is `suspicious`  
- **Partial:** only `warning` (counts as miss for primary suspicious metric, but note as “under-called”)

Among clips with `gt_should_suspicious = 0`:

- Any `suspicious` = FP  
- `warning` on `normal` = soft FP (track separately; don’t optimize to zero at cost of all sensitivity)

### 5.4 What to write in the summary

After each eval pass, append to `docs/BASELINE_NOTES.md` or `docs/THRESHOLD_NOTES.md`:

```text
Date / tag: 2026-07-31 week1
Clips: N (exclude cal-failed: K)
Suspicious precision / recall / F1: ...
phone_risk precision / recall: ...
False suspicious on normal: X / Y clips; ~Z per minute
Biggest failure mode: ...
```

---

## 6. Targets (Week 1–2)

| Metric | Day 7 baseline | Day 10 target |
|--------|----------------|---------------|
| Suspicious precision | Measure only | ≥ **0.70** |
| Suspicious recall | Measure only | ≥ **0.60** (don’t sacrifice precision to chase 1.0) |
| `phone_risk` precision | N/A until hands in browser | ≥ **0.70** on phone_risk + normal set |
| False `suspicious` on `normal` | Measure | ≤ **1** per **2 minutes** of normal footage |
| Calibration gate | Manual | Failed cal never enters scored set |

If precision and recall conflict, **prefer precision** for sellable soft proctoring.

---

## 7. Eval run checklist

1. Pull latest detector constants; note git commit hash in results CSV `notes` or summary.  
2. Confirm taxonomy ids still match code.  
3. Record / re-play clips per §3.  
4. Fill `labels.csv` **before** looking at predictions when possible (or freeze labels and don’t edit after seeing outputs except for documentation errors).  
5. Export predictions → `results_<tag>.csv`.  
6. Compute §5 tables (spreadsheet or small script).  
7. Write failure modes; only then change thresholds (Day 10).  
8. Re-run the **same** clip set after tuning — never tune on a one-off live fidget.

---

## 8. Anti-patterns

- Tuning thresholds on a single clip until it “looks good”  
- Relabeling ground truth to match the model  
- Mixing lighting setups in one batch without a new `batch_id`  
- Counting a 1-second glance as `gt_should_suspicious = 1`  
- Claiming production quality from &lt;20 clips  
- Including failed-calibration clips in gaze precision/recall  

---

## 9. Day 1 / Day 7 ownership

| When | Deliverable |
|------|-------------|
| Day 1 | This protocol + empty `data/eval/labels.csv` template + `results` header |
| Day 1 | `docs/BASELINE_NOTES.md` after 3 informal runs (failure modes) |
| Day 7 | ≥20 labeled clips + `results_week1.csv` + precision/recall paragraph |
| Day 10 | Retune → `results_week2.csv` + `THRESHOLD_NOTES.md` |

Until a script exists, compute metrics in a spreadsheet; automation is optional and must not block Day 7.
