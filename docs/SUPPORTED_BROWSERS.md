# Side Note — Supported browsers

**Last smoke:** 2026-08-03 (local `python run_server.py` → `http://127.0.0.1:8000`)  
**Engines tested:** Chromium (Chrome) + WebKit (Safari engine) via Playwright headless

---

## Recommendation

| Priority | Browser | Notes |
|----------|---------|--------|
| **Primary** | **Google Chrome** (current stable) | Best WebGazer + MediaPipe path. Use this for demos and pilots. |
| **Also fine** | **Microsoft Edge** (Chromium) | Same engine family as Chrome — treat as supported. |
| **Secondary** | **Safari** (macOS / iOS Safari) | Page + scripts load; camera/calibration less reliable than Chrome. Prefer Chrome for accuracy checks. |
| **Not supported** | **Firefox** | No pilot coverage; WebGazer/MediaPipe often flaky. Do not demo on Firefox. |

**Hard requirements**

- Serve over **`http://localhost…`** or **HTTPS** (camera blocked on `file://` and plain HTTP remote hosts).
- Laptop **webcam**; front lighting; maximized window for calibration.
- Allow **camera** when prompted.

---

## Smoke results (2026-08-03)

Automated headless smoke (no live webcam / no 9-point calibration):

| Check | Chromium (Chrome engine) | WebKit (Safari engine) |
|-------|--------------------------|-------------------------|
| `GET /api/health` → `ok` | Pass | Pass |
| `demo.html` 200 + title | Pass | Pass |
| `#btnStartCamera` present | Pass | Pass |
| Offline banner present (hidden when online) | Pass | Pass |
| `window.webgazer` + `.begin` | Pass | Pass |
| `SideNoteGaze` / `SideNoteAPI` / detector | Pass | Pass |
| WebGazer source = `local` | Pass | Pass |
| Face Mesh source = `cdn` | Pass | Pass |
| Library status “Camera tracking is ready” | Pass | Pass |
| API status “Server connected…” | Pass | Pass |
| `index.html` tagline | Pass | Pass |
| `sessions.html` lists sessions | Pass | Pass |
| Page `console` errors | None | None |

**Not covered by this smoke** (needs a human + camera):

- Camera permission grant / revoke
- 9-point calibration + accuracy gate
- Live integrity signals (`phone_risk`, `looking_down`, …)
- Tab-blur soft note, camera-loss pause UI
- Evidence JPEG capture
- Offline “session not saved” banner while API is down (flip by stopping `run_server.py`)

---

## Manual smoke checklist (Chrome + one other)

Run with backend up: `python run_server.py` → open `/demo.html`.

1. Welcome: library status ready; API connected (or offline banner if server stopped).
2. Turn on camera → checklist → calibrate 9 points → accuracy check passes or fails clearly.
3. Start exam: Integrity monitor shows **Clear**; gaze optional.
4. Leave tab ≥2s → soft **`tab_blur`** note (not scored).
5. Submit → report shows score explanation + disclaimer; download JSON works offline.
6. With backend up: session appears on `/sessions.html`.

Do steps 1–6 in **Chrome**, then repeat at least steps 1–3 and 5 in **Safari** or **Edge**.

---

## Known browser caveats

| Topic | Detail |
|-------|--------|
| Safari WebGazer | SETUP historically reports weaker tracking; prefer Chrome for pilots. |
| Safari Face Mesh CDN | Needs network to jsDelivr; local WebGazer bundle still loads. |
| iOS Safari | Untested for exams; viewport/fullscreen behavior differs. |
| Firefox | Unsupported — expect broken or silent tracking. |
| Incognito / strict tracking prevention | May block camera or storage; use a normal profile for demos. |
| Multiple cameras | OS may pick the wrong device; check the bottom-left preview. |

---

## Support policy (product)

- **Pilot / classroom:** Chrome only (Edge OK if IT locks Chrome).
- **Marketing copy:** “Works best in Chrome or Edge.”
- **Bugs:** Reproduce in Chrome before filing; note Safari/Firefox as secondary if relevant.

When this matrix drifts from code (new Face Mesh host, WebGazer bundle changes), **re-run the smoke** and update the date at the top of this file.
