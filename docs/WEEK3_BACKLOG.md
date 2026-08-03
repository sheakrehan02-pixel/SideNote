# Side Note — Week 3 backlog

Post–MVP freeze (`week2_tune`, Day 14). Thresholds stay frozen unless a new labeled eval batch says otherwise.

**Theme:** Make the demo **pilot-safe** — who can see what, where data lives, evidence that survives refresh, and one real classroom run.

**Out of scope for Week 3:** model retunes, Firefox support, mobile apps, LMS deep integrations.

---

## Priority order

| # | Workstream | Why first |
|---|------------|-----------|
| 1 | **Auth** | Sessions + evidence are open today; unsafe for a real class |
| 2 | **Evidence → disk** | Stills are in-browser / JSON; instructors need durable URLs |
| 3 | **Postgres** | SQLite is fine for demos; multi-machine / concurrent pilots need a real DB |
| 4 | **First real pilot** | Validates the above under live conditions |

Do **1 → 2** before inviting students. Postgres can land in parallel with evidence if needed, but auth + disk evidence are the pilot blockers.

---

## 1. Auth (student vs instructor)

### Goal
Separate **take exam** from **review sessions**. No anonymous browse of `/sessions.html` or raw `/api/sessions`.

### Scope

| Item | Notes |
|------|--------|
| Roles | `student` (create/submit own session) · `instructor` (list/read all + evidence) |
| Login | Simple email + password or magic link for Week 3; no SSO required yet |
| Session cookie / JWT | Prefer HTTP-only cookie for browser demo; document token for API scripts |
| Route guards | UI: hide instructor links when logged out · API: 401/403 on list/detail/submit |
| Student binding | Session `student_name` / optional `user_id` must match authenticated student on create/submit |
| Instructor-only pages | `sessions.html`, `session.html`, evidence image URLs |

### Acceptance

- [ ] Unauthenticated `GET /api/sessions` → **401**
- [ ] Student cannot `GET` another student’s session
- [ ] Instructor can list + open any session + evidence
- [ ] Demo still runnable locally with a seeded instructor + 1–2 student accounts (documented in SETUP)
- [ ] Soft-proctoring copy unchanged (signals for review, not auto-fail)

### Stretch (if time)

- Invite codes / exam codes so students join a specific `exam_id`
- Audit log: who viewed which session

---

## 2. Upload evidence to disk

### Today
`SideNoteEvidence` captures JPEG **data URLs** in memory; report embeds them. `evidence_path` on events is often empty or not a real file. Refresh / new machine → stills gone.

### Goal
On suspicious / `phone_risk` (and other capture-worthy flags), **upload bytes to the server**, store under `data/evidence/<session_id>/`, persist a relative path on the event + report gallery.

### Scope

| Item | Notes |
|------|--------|
| API | `POST /api/sessions/{id}/evidence` — multipart or base64 body; returns `{ path, url }` |
| Disk layout | `data/evidence/{session_id}/{timestamp}_{flag_id}.jpg` (gitignored) |
| DB | Fill `session_events.evidence_path`; report gallery reads paths/URLs, not huge data URLs |
| Serving | Authenticated `GET /api/sessions/{id}/evidence/{filename}` (or static mount behind auth) |
| Caps | Keep existing max items / cooldown; reject oversized uploads |
| Client | `evidence-capture.js` + `api-client.js`: upload after capture; fall back to local-only if API down (banner already exists) |

### Acceptance

- [ ] After a needs-review flag, a JPEG exists on disk and `evidence_path` is set
- [ ] Instructor session detail gallery loads from server URLs after page reload
- [ ] Data URLs are not required in SQLite/Postgres JSON for the happy path
- [ ] Offline / API-down: demo still works; banner notes evidence may be local-only

### Stretch

- Strip EXIF; optional blur faces in stored stills for privacy policy later
- TTL / retention job (delete evidence after N days)

---

## 3. Postgres

### Today
SQLite at `data/sidenote.db` — fine for single-process demos.

### Goal
Support a shared backend for a small pilot (several students overlapping) without file-lock pain.

### Scope

| Item | Notes |
|------|--------|
| Driver | SQLAlchemy or keep raw SQL with `psycopg` — pick one and migrate `database.py` |
| Config | `DATABASE_URL` env (default: SQLite for local; Postgres in pilot deploy) |
| Schema | Same logical tables: `users` (new), `sessions`, `session_events`; keep `SCHEMA_VERSION` / migrations story |
| Deploy | One-page note: Docker Compose or managed Postgres + `run_server.py` |
| Backup | Document `pg_dump` / evidence directory backup together |

### Acceptance

- [ ] App boots on Postgres with empty schema and on SQLite for local dev
- [ ] Create session → events → submit → list/detail identical behavior
- [ ] Evidence paths still resolve after DB cutover
- [ ] backend README documents both modes

### Stretch

- Connection pooling; read replica (not needed for first pilot)

---

## 4. First real pilot

### Goal
One **real** exam-ish run with **≥3 students** + **1 instructor**, using Chrome, auth, and disk evidence — not scripted clips.

### Prep checklist

- [ ] Auth + evidence-to-disk merged and smoke-tested
- [ ] Seeded instructor account; student accounts or join codes
- [ ] Pilot script rehearsed ([`PILOT_SCRIPT.md`](./PILOT_SCRIPT.md)); soft-copy language only
- [ ] Browser: Chrome; lighting/checklist enforced
- [ ] Consent / disclosure one-pager (camera + soft monitoring + human review)
- [ ] Rollback: know how to wipe or export sessions if something goes wrong

### During (~1 sitting)

| Step | Success look |
|------|----------------|
| Students calibrate + start | Hard gates pass; no “Start” without identity/cal |
| Normal work | Few or no false *Needs review* on honest reading |
| Optional scripted moment | One student briefly looks down / off-screen for instructor demo |
| Submit | Sessions appear for instructor with score + timeline |
| Evidence | ≥1 still on disk for a needs-review event (if any fired) |

### After (same week)

- [ ] Export: session JSON + evidence folder for the pilot batch
- [ ] Label 10–20 live moments per [`EVAL_PROTOCOL.md`](./EVAL_PROTOCOL.md) (even informal)
- [ ] Write short **pilot notes**: what fired, false alarms, setup failures, student quotes
- [ ] Decide Week 4: unfreeze thresholds only if live labels justify it

### Success criteria (pilot “done”)

- Instructor reviews **all** completed sessions without asking eng for the DB
- At least one session has durable evidence on disk (or a written note that no suspicious events fired)
- Documented blockers for Week 4 (auth pain, cal failures, FP/FN themes)

---

## Suggested week shape

| Day | Focus |
|-----|--------|
| Mon–Tue | Auth (API + UI gates + seed users) |
| Wed | Evidence upload + gallery URLs |
| Thu | Postgres (or finish evidence + harden) |
| Fri | Dry run → **real pilot** → notes |

If behind: **slip Postgres**, keep SQLite for the first pilot, but **do not slip auth or disk evidence**.

---

## Explicit non-goals (Week 3)

- Changing `cheating-detector.js` / `hand-engine.js` freeze constants
- Auto email to students (“you were flagged”)
- Full FERPA/legal review (start a consent blurb only)
- Mobile Safari as primary
- Replacing WebGazer

---

## Related

- [`THRESHOLD_NOTES.md`](./THRESHOLD_NOTES.md) — freeze rules  
- [`PILOT_SCRIPT.md`](./PILOT_SCRIPT.md) — demo talk track  
- [`EVAL_PROTOCOL.md`](./EVAL_PROTOCOL.md) — how to label live clips after pilot  
- [`SUPPORTED_BROWSERS.md`](./SUPPORTED_BROWSERS.md) — Chrome-first  
- [`../README.md`](../README.md) — how to run / known limits  
- [`../backend/README.md`](../backend/README.md) — current SQLite API  
