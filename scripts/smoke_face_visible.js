/**
 * Smoke test: cover camera / leave frame → face_not_visible fires cleanly.
 *
 * Simulates the app.js wiring:
 *   WebGazer still provides gaze samples, but faceVisible comes from Face Mesh.
 *   When the face is gone, gaze must be ignored and face_not_visible must escalate.
 *
 * Usage: node scripts/smoke_face_visible.js
 * Exit 0 = pass, 1 = fail
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const detectorPath = path.join(__dirname, '..', 'website', 'js', 'cheating-detector.js');
const code = fs.readFileSync(detectorPath, 'utf8');
const sandbox = { innerWidth: 1440, innerHeight: 900, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const CheatingDetector = sandbox.SideNoteCheatingDetector;
const failures = [];

function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

function gazeCenter() {
  return { x: 720, y: 400 };
}

/** Mirrors app.js buildDetectorInput: no face → null gaze */
function buildInput(gazeSample, faceVisible) {
  return {
    gaze: faceVisible ? gazeSample : null,
    faceVisible: !!faceVisible,
    hands: null,
    headPose: faceVisible ? { pitch: 0.02, yaw: 0.01, roll: 0 } : null,
    facesCount: faceVisible ? 1 : 0
  };
}

function run() {
  const d = new CheatingDetector();
  const timeline = [];
  let last = 'ok';

  // Phase A: face present + center gaze — must stay ok
  for (let i = 0; i < 20; i++) {
    const r = d.update(buildInput(gazeCenter(), true));
    if (r.status !== last) {
      timeline.push({ phase: 'visible', frame: i, status: r.status, flags: r.flags });
      last = r.status;
    }
  }
  assert(last === 'ok', 'Phase A: expected ok while face visible, got ' + last);
  assert(
    !timeline.some((t) => (t.flags || []).some((f) => f.id === 'face_not_visible')),
    'Phase A: face_not_visible must not fire while face is visible'
  );

  // Phase B: cover camera / leave frame — WebGazer may still emit gaze; ignore it
  let warningAt = null;
  let suspiciousAt = null;
  for (let i = 0; i < 30; i++) {
    const r = d.update(buildInput(gazeCenter(), false));
    if (r.status !== last) {
      timeline.push({ phase: 'covered', frame: i, status: r.status, flags: r.flags });
      last = r.status;
    }
    const top = (r.flags || [])[0];
    if (top && top.id === 'face_not_visible' && top.severity === 'warning' && warningAt == null) {
      warningAt = i;
    }
    if (top && top.id === 'face_not_visible' && top.severity === 'suspicious' && suspiciousAt == null) {
      suspiciousAt = i;
    }
  }

  assert(warningAt != null, 'Phase B: face_not_visible warning never fired');
  assert(suspiciousAt != null, 'Phase B: face_not_visible did not escalate to suspicious');
  assert(
    warningAt != null && suspiciousAt != null && suspiciousAt > warningAt,
    'Phase B: suspicious should come after warning'
  );

  // Ensure no looking_down from stale gaze while covered
  const coveredFlags = timeline
    .filter((t) => t.phase === 'covered')
    .flatMap((t) => t.flags || []);
  assert(
    !coveredFlags.some((f) => f.id === 'looking_down' || f.id === 'gaze_off_screen'),
    'Phase B: must not emit gaze zone flags while faceVisible=false (stale WebGazer gaze ignored)'
  );
  assert(
    coveredFlags.every((f) => f.id === 'face_not_visible'),
    'Phase B: only face_not_visible should be active while covered'
  );

  // Phase C: face returns — should clear back toward ok
  let cleared = false;
  for (let i = 0; i < 15; i++) {
    const r = d.update(buildInput(gazeCenter(), true));
    if (r.status === 'ok') {
      cleared = true;
      timeline.push({ phase: 'returned', frame: i, status: r.status, flags: r.flags });
      break;
    }
  }
  assert(cleared, 'Phase C: status did not return to ok after face reappeared');

  return timeline;
}

const timeline = run();
const passed = failures.length === 0;

console.log(JSON.stringify({
  ok: passed,
  failures: failures,
  timeline: timeline
}, null, 2));

if (!passed) {
  console.error('\nSMOKE FAIL: face_not_visible path broken');
  process.exit(1);
}

console.log('\nSMOKE PASS: cover camera / leave frame → face_not_visible fires cleanly');
process.exit(0);
