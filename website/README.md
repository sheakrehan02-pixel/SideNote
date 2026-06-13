# Side Note Showcase Website

Simple pitch website for Side Note with an interactive eye-tracking prototype.

## Run locally

From this folder:

```bash
python3 -m http.server 8000
```

Then open **http://localhost:8000/demo.html** (not `file://` — camera requires HTTP).

**First time?** Read **[SETUP.md](SETUP.md)** for lighting, calibration, and troubleshooting.

## Deploy to Vercel

1. **Push to GitHub** (from project root):
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/REPO_NAME.git
   git push -u origin main
   ```

2. **Deploy on Vercel**:
   - Go to [vercel.com](https://vercel.com) → Sign in with GitHub
   - Click "Add New" → "Project" → Import your repo
   - **Root Directory**: Set to `website` (important)
   - Click Deploy

3. You'll get a URL like `your-project.vercel.app`

## Files

- **index.html** — Main pitch page
- **demo.html** — Guided proctoring demo (calibration → exam → report)
- **SETUP.md** — Step-by-step setup and troubleshooting
- **css/demo.css** — Demo styles
- **js/gaze-engine.js** — WebGazer wrapper
- **js/cheating-detector.js** — Integrity rules
- **js/app.js** — Wizard logic
- **logo.svg** — Brand logo
