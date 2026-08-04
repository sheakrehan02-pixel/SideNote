# Mendeley suspicious-behaviors insights (accuracy_v2)

Source: Students suspicious behaviors detection dataset V1 (5,500 rows).
Local CSV: `~/Downloads/Students suspicious behaviors detection dataset fo/` or `data/datasets/mendeley_suspicious_behaviors/dataset_v1.csv`.

Analyze: `python3 scripts/analyze_mendeley_behaviors.py`

## Label mix
- honest (0): 2881
- suspicious (1): 2619

## Rule metrics (predict label=1)

| Rule | Precision | Recall | F1 |
|------|----------:|-------:|---:|
| `face_miss` | 1.000 | 0.067 | 0.126 |
| `multi_face` | 1.000 | 0.043 | 0.083 |
| `phone_present` | 1.000 | 0.295 | 0.456 |
| `hand_obj_interaction` | 1.000 | 0.320 | 0.485 |
| `gaze_off_script` | 0.788 | 0.574 | 0.664 |
| `gaze_corner` | 1.000 | 0.328 | 0.493 |
| `pose_not_forward` | 1.000 | 0.380 | 0.551 |
| `pose_missing` | 1.000 | 0.217 | 0.357 |
| `hands_low_0.58` | 0.365 | 0.276 | 0.315 |
| `yaw_abs>0.05` | 1.000 | 0.076 | 0.141 |
| `phone_or_face_miss` | 1.000 | 0.341 | 0.509 |
| `off_script_or_phone` | 0.831 | 0.760 | 0.794 |
| `soft_score>=2` | 0.834 | 0.775 | 0.803 |

## Applied to Side Note

- Keep `phone_risk` = looking_down + hands_in_lap (hands alone weak here).
- Enable `multiple_faces` when Face Mesh `facesCount >= 2` (perfect precision in this set).
- Categorical head-pose buckets (forward/down/left/right) with |yaw|≥0.05 / pitch≥0.04.
- Do **not** retune frozen LAP/OFF/PHONE frame constants from this batch alone.

