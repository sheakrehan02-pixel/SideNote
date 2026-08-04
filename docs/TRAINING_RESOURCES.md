# Training Resources for Side Note

Datasets, papers, and tools you can use to train or improve the eye-tracking and cheating-detection model.

---

## 1. Gaze / eye-tracking datasets

Use these to train or fine-tune **gaze estimation** (where the person is looking).

| Dataset | Size | Description | Link | License |
|--------|------|-------------|------|--------|
| **ETH-XGaze** | 1M+ images, 110 people | Large-scale; extreme head pose & gaze. Face patches 224×224 / 448×448. | [ait.ethz.ch/xgaze](https://ait.ethz.ch/xgaze) | CC BY-NC-SA 4.0 |
| **MPIIGaze** | 213K images, 15 people | In-the-wild laptop use; appearance + illumination variation. | [Collaborative AI](https://www.collaborative-ai.org/research/datasets/MPIIGaze/), [Kaggle](https://www.kaggle.com/c/mp18-eye-gaze-estimation/data) | Non-commercial |
| **Gaze360** | 238 subjects | 3D gaze, indoor/outdoor, unconstrained. | [gaze360.csail.mit.edu](https://gaze360.csail.mit.edu/) | Check site |
| **RT-GENE** | 15 people, 17 sessions | Natural + eyetracking-glasses (ground truth). | [Zenodo](https://zenodo.org/records/2529036) | CC BY-NC-SA 4.0 |

**Practical pick for “looking at screen vs down”:**  
ETH-XGaze or MPIIGaze for gaze direction; you can define your own “on-screen” vs “off-screen” (e.g. down = lap/phone) from gaze angles.

---

## 2. Cheating / proctoring datasets

Use these to train **cheating detection** (suspicious behavior during exams).

| Dataset | Size | Description | Link |
|--------|------|-------------|------|
| **Students suspicious behaviors (Mendeley)** | 5,500 records, 38 CV features | Face, hands, head pose, phone, gaze. Balanced cheating vs non-cheating. MediaPipe/OpenCV features. | [Mendeley Data](https://data.mendeley.com/datasets/39xs8th543) |
| **MSU OEP (Online Exam Proctoring)** | 24 sessions | Webcam + wearable camera + audio; 5 cheating behaviors with timestamps. | [MSU CV Lab](http://cvlab.cse.msu.edu/oep-dataset.html) |
| **Cheating detection (Kaggle)** | Varies | General cheating-detection dataset. | [Kaggle](https://www.kaggle.com/datasets/rahimatanveer1/cheating-detection-dataset) |

The **Mendeley dataset** is especially useful: it already has hand tracking, head pose, gaze, and phone-related attributes, so you can train a classifier (e.g. Random Forest, XGBoost, or a small neural net) on these features.

---

## 3. Things you can train

- **Gaze estimator:** Train or fine-tune a model on ETH-XGaze / MPIIGaze / Gaze360 to get better gaze angles, then map “looking down” or “off-screen” to your cheating rules.
- **Cheating classifier:** Use the Mendeley or OEP data to train a binary or multi-class model (cheating vs not, or by behavior type).
- **Head pose:** Use head pose as a proxy for “looking at screen” (e.g. pitch down = looking at lap). Datasets like 300W-LP, AFLW, or WFLW include pose; you can also use MediaPipe face mesh and fit a pose from landmarks.
- **Hand position:** MediaPipe Hands is already strong; you can collect your own “hands in lap” vs “hands on keyboard” and fine-tune or add a small classifier on top of landmark features.

---

## 4. Frameworks & code

- **PyTorch / TensorFlow:** For custom gaze or behavior models.
- **MediaPipe:** Already used in this project; good for face mesh, hands, and pose as feature extractors.
- **Gaze360 (official):** [GitHub](https://github.com/Erkil1452/gaze360) and [yihuacheng/Gaze360](https://github.com/yihuacheng/Gaze360) for data loading and training code.
- **ETH-XGaze:** Check the official page for evaluation protocol and baselines.

---

## 5. Suggested pipeline for Side Note

1. **Short term:** Keep current rule-based system; optionally collect your own labeled clips (looking down, hands in lap, on-screen) and train a small classifier on MediaPipe + OpenCV features (gaze direction, hand wrist Y, face bbox).
2. **Medium term:** Add a gaze model trained or fine-tuned on MPIIGaze or ETH-XGaze; map output to “on-screen” vs “looking down” vs “looking away.”
3. **Long term:** Train or adapt a multimodal model (e.g. transformer over time) on Mendeley or OEP for end-to-end cheating detection, and use our hand/gaze/face rules as features or post-processing.

---

## 6. Papers (optional reading)

- **MPIIGaze:** *Appearance-Based Gaze Estimation in the Wild* (CVPR 2015).  
- **ETH-XGaze:** *ETH-XGaze: A Large Scale Dataset for Gaze Estimation under Extreme Head Pose and Gaze Variation* (ECCV 2020).  
- **Gaze360:** *Gaze360: Physically Unconstrained Gaze Estimation in the Wild* (ICCV 2019).  
- **Proctoring:** *Multimodal Transformer Framework for Real-Time Cheating Detection in Online Assessments* (Springer); *Students suspicious behaviors detection dataset for AI-powered online exam proctoring* (Mendeley Data).



### Local copy (this repo)

If present: `data/datasets/mendeley_suspicious_behaviors/dataset_v1.csv`

```bash
python3 scripts/analyze_mendeley_behaviors.py
# → data/datasets/mendeley_suspicious_behaviors/insights.json
```

**What we learned (accuracy_v2):** missing face, phone present, non-forward head pose, corner gaze, and `no_of_face≥2` were **perfect precision** on this corpus; hands-low alone was weak (keep `phone_risk` co-occurrence). Soft score F1 ≈ **0.80**.

## 7. What to collect for Side Note (highest value)

Large public gaze datasets (ETH-XGaze, etc.) help **research models**, not the current WebGazer demo overnight. For the next accuracy jump, send **your** clips:

### Preferred (upload or drop in `data/eval/clips/`)

| Item | Spec |
|------|------|
| Format | 30–60s webcam video **or** exported session JSON from the demo |
| Lighting | Front-lit face (same as pilot) |
| Labels | Per clip: `normal` · `looking_down` · `gaze_off_screen` · `hands_in_lap` · `phone_risk` · `face_away` |
| Count | Aim for **≥20** labeled clips (mix of honest + suspicious) |
| Browser | Chrome, maximized, after a **passed** accuracy check |

### Optional public sets (if you have bandwidth)

1. **[Mendeley suspicious behaviors](https://data.mendeley.com/datasets/39xs8th543)** — best match for integrity features (hands/pose/gaze).  
2. **[MSU OEP](http://cvlab.cse.msu.edu/oep-dataset.html)** — timed cheating behaviors.  
3. **MPIIGaze / ETH-XGaze** — only if we train a custom gaze net (multi‑GB; Week 3+).

You do **not** need to download those for the current demo — the `accuracy_v1` pipeline upgrades are already in the web client.

---

## Quick links

- [ETH-XGaze](https://ait.ethz.ch/xgaze)
- [MPIIGaze (Kaggle)](https://www.kaggle.com/c/mp18-eye-gaze-estimation/data)
- [Gaze360](https://gaze360.csail.mit.edu/)
- [Mendeley – suspicious behaviors](https://data.mendeley.com/datasets/39xs8th543)
- [MSU OEP dataset](http://cvlab.cse.msu.edu/oep-dataset.html)
- [RT-GENE (Zenodo)](https://zenodo.org/records/2529036)
