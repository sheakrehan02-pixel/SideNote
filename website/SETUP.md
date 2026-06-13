# Side Note — Setup Guide

Follow these steps in order. WebGazer accuracy is **80% environment + calibration**, not magic — skipping steps is why tracking feels broken.

---

## Step 1: Install nothing extra (web demo)

You only need:

- **Chrome** or **Edge** (recommended)
- A **laptop with webcam**
- This repo cloned on your machine

Optional (desktop proctoring with hands detection):

```bash
pip install -r requirements.txt
python main.py
```

---

## Step 2: Run a local web server

WebGazer **will not work** if you double-click `demo.html` (`file://`). You must use HTTP.

From the `website` folder:

```bash
cd website
python3 -m http.server 8000
```

Open: **http://localhost:8000/demo.html**

Allow **camera access** when the browser asks.

---

## Step 3: Physical setup (do this every session)

| Check | Why it matters |
|--------|----------------|
| Face lit from the **front** | Backlighting breaks eye detection |
| Webcam at **eye level** | Extreme angles ruin calibration |
| **Arm's length** from screen (~50–70 cm) | Distance changes the gaze model |
| **Maximize** the browser window | Calibration is tied to screen size |
| Keep your **head still**; move **eyes** only | Head motion looks like gaze drift |
| Glasses OK, **no sunglasses** | Tint blocks eye features |

---

## Step 4: Walk through the demo wizard

The demo has 6 steps (dots at the top):

### 1. Welcome
- Wait until you see **"WebGazer ready"**
- Click **Allow camera & continue**

### 2. Checklist
- Confirm lighting and distance
- Click **I'm ready — calibrate**

### 3. Nine-point calibration (most important)
- For **each** green circle: **look at it**, then **click it**
- Complete all **9** points
- Your face must stay visible in the small camera preview (bottom-left)

### 4. Accuracy check
- Look at each test dot (**do not click**)
- Target: average error **under ~180 px**
- If it fails → **Recalibrate** with better lighting

### 5. Practice exam
- Answer sample questions normally
- Watch the **Integrity monitor** sidebar
- Green gaze dot = debug (toggle off for realistic feel)
- Brief looks away trigger **warnings**; sustained looks trigger **flags**

### 6. Report
- Download JSON session log if needed
- **Start over** to retry calibration

---

## Step 5: Deploy online (optional)

1. Push repo to GitHub
2. [Vercel](https://vercel.com) → Import repo → set **Root Directory** to `website`
3. Deploy → open `https://your-app.vercel.app/demo.html`

HTTPS is required for camera on non-localhost URLs.

---

## Troubleshooting

### "WebGazer failed to load"
- Use `http://localhost:8000/demo.html`, not `file://`
- Check internet (CDN) or ensure `website/js/webgazer.js` exists (local fallback)
- Try Chrome/Edge instead of Safari

### Green gaze dot doesn't move
- Redo **all 9 calibration points**
- Improve lighting; face the camera
- Don't move closer/f farther from screen after calibrating
- Check camera preview — is your face detected?

### Dot moves but is inaccurate
- Run **accuracy check**; if &gt; 180 px, recalibrate
- Use `weightedRidge` (already configured in this project)
- Sit still; recalibrate if you change posture or screen brightness

### Camera permission denied
- Browser settings → Site settings → Camera → Allow for localhost
- Close other apps using the webcam (Zoom, FaceTime)

### Safari issues
- Safari works but Chrome/Edge are more reliable for WebGazer + WebGL

---

## What makes this project "production-grade" next

| Phase | You do | We build |
|-------|--------|----------|
| **Now** | Follow setup + calibration | Browser exam + integrity flags |
| **Next** | Collect labeled clips (on-screen vs lap vs away) | Train classifier on MediaPipe features |
| **Later** | LMS iframe embed | Backend session storage + instructor dashboard |
| **Best accuracy** | Tobii or phone sync (research) | Hybrid: WebGazer screen + MediaPipe hands in browser |

See `docs/TRAINING_RESOURCES.md` for datasets (ETH-XGaze, Mendeley proctoring data).

---

## File map

| File | Purpose |
|------|---------|
| `demo.html` | Wizard UI |
| `js/gaze-engine.js` | WebGazer config, smoothing, calibration |
| `js/cheating-detector.js` | Screen-zone proctoring rules |
| `js/app.js` | Wizard + exam flow |
| `main.py` | Desktop app with hands + iris (no screen mapping) |

---

## Quick command reference

```bash
# Web demo
cd website && python3 -m http.server 8000

# Desktop demo (hands + gaze direction)
pip install -r requirements.txt
python main.py
```

Press `q` to quit the desktop app.
