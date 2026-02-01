# Orbitalis Showcase Website

Simple pitch website for Orbitalis with an interactive eye-tracking prototype.

## Run locally

From this folder:

```bash
python -m http.server 8000
```

Then open http://localhost:8000

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
- **demo.html** — Interactive eye-tracking prototype
