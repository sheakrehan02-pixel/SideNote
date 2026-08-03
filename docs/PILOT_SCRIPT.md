# Side Note — 10-minute pilot / demo script

A rehearsable walkthrough for live demos (investor, instructor, or classroom pilot).  
**Audience:** people who care about soft proctoring signals, not raw ML.

**Goal:** Show that Side Note produces **named, reviewable integrity signals** (with evidence) — not a cheating verdict.

**Related:** [`SETUP.md`](../website/SETUP.md) · [`FLAG_TAXONOMY.md`](./FLAG_TAXONOMY.md) · [`THRESHOLD_NOTES.md`](./THRESHOLD_NOTES.md)

---

## Before you start (T−5 min)

| Check | Pass when |
|-------|-----------|
| Backend | `python run_server.py` → `http://localhost:8000/demo.html` |
| Browser | **Chrome** or **Edge**, window **maximized** |
| Lighting | Face lit from the **front** (no bright window behind you) |
| Distance | ~arm’s length from screen |
| Camera | Permission allowed; face visible in preview when prompted |
| Backup tab | `sessions.html` open (hidden until the end) |

**One-liner for the room:**  
> “Side Note watches where you look and whether hands leave the keyboard — then gives instructors a short timeline to review, not an automatic fail.”

---

## Minute-by-minute script (~10:00)

### 0:00–0:45 — Hook (product, not tech)

**Say:**
> Soft proctoring fails when every glance looks like cheating, or when the system stays silent when someone leaves. We’re building named flags instructors can trust — especially phone-in-lap risk.

**Show:** `index.html` or jump straight to `demo.html`.

**Don’t:** Open WebGazer internals or the SQLite file.

---

### 0:45–2:00 — Environment gates (trust the setup)

**Do:**
1. Click **Turn on camera & continue**.
2. On the checklist: tick **lighting**, **distance**, **fullscreen** (use **Enter fullscreen** if needed).
3. Click **I'm ready — calibrate**.

**Say:**
> We refuse to start until the student confirms the setup that makes eye tracking usable. Bad lighting is the #1 false-flag factory.

---

### 2:00–4:00 — Calibration + accuracy (hard gate)

**Do:**
1. Run **9-point calibration** — for each green circle: **look, then click**.
2. Run **accuracy check** — look at dots, don’t click.
3. Enter **name or email**.
4. Only if it **passes** (≤ ~180 px): **Start practice exam**.

**Say:**
> If calibration fails, there is no scored exam. We’d rather block the session than invent a garbage integrity score.

**If accuracy fails live:** Recalibrate once. If it still fails, narrate the gate as the feature and switch to a pre-recorded session on `sessions.html` for the rest.

---

### 4:00–7:30 — Live behaviors (show 3 signals)

Keep the Integrity panel visible. Speak the **flag id** when it appears.

| Time | You do | Expect / point at |
|------|--------|-------------------|
| ~4:00 | Answer Q1 normally, eyes on screen | Status stays **Clear** — “honest work is quiet” |
| ~4:45 | Look at a **second monitor / far side** for ~8–10s | `gaze_off_screen` warning → suspicious |
| ~5:30 | Return to screen briefly | Clears / cools down |
| ~5:45 | Phone or notes in lap: **look down + hands low** ~8–10s | Prefer **`phone_risk`** (not just looking down) |
| ~6:45 | Optional: cover cam / lean out ~5s | `face_not_visible` |

**Say (on phone_risk):**
> Looking at the bottom of the exam alone can look like reading. **Hands in lap plus looking down** is the high-value signal — that’s `phone_risk`, and it weights the score harder.

**Say (on evidence):**
> When risk is high, we grab a short webcam burst — instructors get thumbnails, not vibes.

**Don’t:** Trigger five flags at once; one clear story beats noise.

---

### 7:30–8:30 — Submit & student report

**Do:**
1. **Submit exam**.
2. Point at integrity **score**, event list, and **evidence** thumbnails.

**Say:**
> The student sees the same language we log: named flags and severity. The number is a summary — the timeline is the product.

---

### 8:30–10:00 — Instructor view (close)

**Do:**
1. Open `sessions.html` → click the new row (**View →**).
2. On `session.html?id=…` walk: **score → duration → calibration quality → flag timeline → evidence**.

**Say:**
> In a real pilot, the instructor opens one link after class: who sat the exam, whether calibration passed, what fired, and the stills. Soft proctoring means **human review**, not auto-expulsion.

**Close:**
> Next step for a pilot: one section, one quiz, Chrome only, and a 15-minute instructor debrief on false alarms.

---

## Talking points (if asked)

| Question | Answer |
|----------|--------|
| Is this AI deciding cheating? | No — signals for review. Taxonomy is explicit. |
| What about false positives? | Biggest risk is lower-exam-UI reading looking like “down.” We weight **`phone_risk`** higher and hard-gate calibration. |
| Does Vercel alone work? | Static demo can track eyes; **sessions need** `python run_server.py`. |
| Glasses / dark room? | Glasses OK; backlight and sunglasses break tracking — checklist is there for a reason. |
| Desktop vs web? | Pilot path is the **web demo**; desktop `main.py` is a separate hands/iris stack. |

---

## Failure recovery (keep the room)

| Glitch | Recovery |
|--------|----------|
| Camera / WebGazer error | Hard refresh; confirm HTTPS or localhost; re-allow camera |
| Accuracy won’t pass | Improve light; sit still; recalibrate; or show a prior session detail |
| No `phone_risk` | Hands not detected — still show `looking_down`, explain co-occurrence |
| Backend offline | Finish live exam narration; explain sessions need the API; show taxonomy doc |

---

## Optional 2-minute appendix (if you have time)

- Open `docs/FLAG_TAXONOMY.md` — severity ladder + `phone_risk` evidence rule.  
- Mention Week 1 scripted baseline (~90% P/R on controlled clips) and that live pilots measure **false suspicious on normal work**.

---

## Checklist card (print / sticky)

```text
[ ] Chrome maximized, front light, arm’s length
[ ] run_server.py → demo.html
[ ] Checklist confirms → 9-point cal → accuracy pass → name
[ ] Demo: normal → side look → phone_risk (down + hands)
[ ] Submit → sessions.html → session detail (score, cal, timeline, evidence)
[ ] Close: review tool, not verdict
```
