#!/usr/bin/env python3
"""
Analyze the Mendeley "Students suspicious behaviors" CSV for Side Note gates.

Default CSV search order:
  1) data/datasets/mendeley_suspicious_behaviors/dataset_v1.csv
  2) ~/Downloads/Students suspicious behaviors detection dataset fo/...V1.csv
  3) path passed as argv[1]

Writes insights.json next to the dataset README.
"""
from __future__ import annotations

import csv
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "datasets" / "mendeley_suspicious_behaviors"
DOWNLOADS_CSV = (
    Path.home()
    / "Downloads"
    / "Students suspicious behaviors detection dataset fo"
    / "Students suspicious behaviors detection dataset_V1.csv"
)


def find_csv(argv: list[str]) -> Path:
    if len(argv) > 1:
        p = Path(argv[1]).expanduser()
        if not p.is_file():
            raise SystemExit(f"CSV not found: {p}")
        return p
    local = OUT_DIR / "dataset_v1.csv"
    if local.is_file():
        return local
    if DOWNLOADS_CSV.is_file():
        return DOWNLOADS_CSV
    raise SystemExit(
        "CSV not found. Copy dataset_v1.csv into "
        f"{OUT_DIR} or pass an absolute path."
    )


def fnum(row: dict, key: str, default: float = 0.0) -> float:
    try:
        return float(row.get(key) or 0)
    except (TypeError, ValueError):
        return default


def ylab(row: dict) -> int:
    return int(float(row["label"]))


def max_hand_y(row: dict) -> float:
    if fnum(row, "hand_count") <= 0:
        return 0.0
    ys = []
    for k in ("left_hand_y", "right_hand_y"):
        v = fnum(row, k)
        if v > 0:
            ys.append(v)
    return max(ys) if ys else 0.0


def proxies(row: dict) -> dict:
    gd = (row.get("gaze_direction") or "").lower()
    pose = (row.get("head_pose") or "").lower()
    hy = max_hand_y(row)
    return {
        "face_miss": fnum(row, "face_present") < 0.5 or fnum(row, "no_of_face") < 0.5,
        "multi_face": fnum(row, "no_of_face") >= 2,
        "phone": fnum(row, "phone_present") >= 0.5,
        "hand_obj": fnum(row, "hand_obj_interaction") >= 0.5,
        "gaze_off_script": fnum(row, "gaze_on_script") < 0.5,
        "gaze_corner": gd in ("bottom_left", "bottom_right", "top_left", "top_right"),
        "pose_not_forward": pose not in ("forward", "") and pose != "none" and bool(pose),
        "pose_missing": pose in ("", "none") or row.get("head_pose") in (None, "None"),
        "hands_low": hy >= 0.58,
        "yaw_abs": abs(fnum(row, "head_yaw")),
        "pitch": fnum(row, "head_pitch"),
    }


def score_rule(rows: list[dict], pred_fn):
    tp = fp = fn = tn = 0
    for r in rows:
        pred = bool(pred_fn(proxies(r)))
        y = ylab(r) == 1
        if pred and y:
            tp += 1
        elif pred and not y:
            fp += 1
        elif not pred and y:
            fn += 1
        else:
            tn += 1
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    return {
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
        "precision": round(prec, 4),
        "recall": round(rec, 4),
        "f1": round(f1, 4),
    }


def main() -> None:
    csv_path = find_csv(sys.argv)
    with csv_path.open(newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    rules = {
        "face_miss": lambda p: p["face_miss"],
        "multi_face": lambda p: p["multi_face"],
        "phone_present": lambda p: p["phone"],
        "hand_obj_interaction": lambda p: p["hand_obj"],
        "gaze_off_script": lambda p: p["gaze_off_script"],
        "gaze_corner": lambda p: p["gaze_corner"],
        "pose_not_forward": lambda p: p["pose_not_forward"],
        "pose_missing": lambda p: p["pose_missing"],
        "hands_low_0.58": lambda p: p["hands_low"],
        "yaw_abs>0.05": lambda p: p["yaw_abs"] > 0.05,
        "phone_or_face_miss": lambda p: p["phone"] or p["face_miss"],
        "off_script_or_phone": lambda p: p["gaze_off_script"] or p["phone"],
        "soft_score>=2": lambda p: (
            (2 if p["face_miss"] else 0)
            + (2 if p["phone"] else 0)
            + (2 if p["gaze_off_script"] else 0)
            + (1 if p["hands_low"] else 0)
            + (1 if p["gaze_corner"] else 0)
        )
        >= 2,
    }

    rule_metrics = {name: score_rule(rows, fn) for name, fn in rules.items()}

    # Categorical cheat rates
    def cheat_rate(col: str):
        by = defaultdict(Counter)
        for r in rows:
            by[str(r.get(col))][ylab(r)] += 1
        out = {}
        for k, c in by.items():
            n = c[0] + c[1]
            out[k] = {
                "n": n,
                "cheat_rate": round(c[1] / n, 4) if n else 0.0,
                "label_0": c[0],
                "label_1": c[1],
            }
        return out

    insights = {
        "source_csv": str(csv_path),
        "rows": len(rows),
        "label_counts": dict(Counter(ylab(r) for r in rows)),
        "rule_metrics": rule_metrics,
        "categorical_cheat_rates": {
            "gaze_direction": cheat_rate("gaze_direction"),
            "head_pose": cheat_rate("head_pose"),
            "phone_present": cheat_rate("phone_present"),
            "face_present": cheat_rate("face_present"),
            "gaze_on_script": cheat_rate("gaze_on_script"),
        },
        "recommended_gates": {
            "note": (
                "Perfect-precision cues in this dataset: missing face, phone present, "
                "non-forward head_pose, corner gaze_direction, hand_obj_interaction. "
                "hands_low alone is weak (prefer co-occurrence). "
                "Map to Side Note: face_not_visible, phone_risk (gaze down + hands), "
                "gaze_off_screen, looking_down; keep ABS_LAP near 0.58."
            ),
            "keep_hands_alone_non_suspicious": True,
            "abs_lap_enter_y": 0.58,
            "treat_faces_count_ge_2_as_review": True,
            "prefer_head_pose_buckets_over_raw_pitch": True,
            "gaze_off_script_proxy": "gaze_on_script==0 ≈ off-task (P~0.79 in this set)",
            "soft_score_weights": {
                "face_miss": 2,
                "phone": 2,
                "gaze_off_script": 2,
                "hands_low": 1,
                "gaze_corner": 1,
                "threshold": 2,
                "expected_f1": rule_metrics["soft_score>=2"]["f1"],
            },
        },
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "insights.json"
    out_path.write_text(json.dumps(insights, indent=2) + "\n", encoding="utf-8")

    print(f"Loaded {len(rows)} rows from {csv_path}")
    print(f"Labels: {insights['label_counts']}")
    print("\nRule metrics (predict label=1):")
    for name, m in rule_metrics.items():
        print(
            f"  {name:24s} P={m['precision']:.3f} R={m['recall']:.3f} "
            f"F1={m['f1']:.3f} (tp={m['tp']} fp={m['fp']})"
        )
    print(f"\nWrote {out_path}")


if __name__ == "__main__":
    main()
