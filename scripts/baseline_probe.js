/**
 * Synthetic baseline probe — runs CheatingDetector through 3 scripted "demo"
 * scenarios without a webcam. Used when live calibration isn't available in CI/agent.
 *
 * Usage: node scripts/baseline_probe.js
 * Or:    open demo, paste into DevTools — but this file is standalone via vm.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const detectorPath = path.join(__dirname, '..', 'website', 'js', 'cheating-detector.js');
const code = fs.readFileSync(detectorPath, 'utf8');

const sandbox = {
  window: {},
  innerWidth: 1440,
  innerHeight: 900,
  console,
};
sandbox.global = sandbox.window;
sandbox.window.innerWidth = 1440;
sandbox.window.innerHeight = 900;
vm.createContext(sandbox);
vm.runInContext(code.replace('(window)', '(global)').replace('global.innerWidth', 'innerWidth').replace('global.innerHeight', 'innerHeight'), sandbox);

// The IIFE uses `global` param as window — fix: re-run with proper binding
const sandbox2 = {
  innerWidth: 1440,
  innerHeight: 900,
  console,
};
sandbox2.window = sandbox2;
vm.createContext(sandbox2);
vm.runInContext(code, sandbox2);

const CheatingDetector = sandbox2.SideNoteCheatingDetector;
if (!CheatingDetector) {
  console.error('Failed to load SideNoteCheatingDetector');
  process.exit(1);
}

function gaze(nx, ny) {
  return { x: nx * sandbox2.innerWidth, y: ny * sandbox2.innerHeight };
}

function runScenario(name, steps) {
  const d = new CheatingDetector();
  const timeline = [];
  let last = 'ok';
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const result = d.update({
      gaze: s.gaze,
      faceVisible: s.faceVisible !== false,
      hands: s.hands != null ? s.hands : null,
      headPose: s.headPose != null ? s.headPose : null,
      facesCount: typeof s.facesCount === 'number' ? s.facesCount : null
    });
    if (result.status !== last) {
      timeline.push({
        frame: i,
        status: result.status,
        messages: result.messages.slice(),
        flags: (result.flags || []).map(function (f) {
          return {
            id: f.id,
            severity: f.severity,
            confidence: f.confidence,
            startedAt: f.startedAt,
            message: f.message
          };
        })
      });
      d.logEvent(result.status, result.messages, result.flags);
      last = result.status;
    }
  }
  const report = d.getReport();
  return { name, timeline, report };
}

// Run 1: Normal center gaze — expect ok / no suspicious
const run1 = runScenario('run1_normal_center', Array.from({ length: 60 }, () => ({
  gaze: gaze(0.5, 0.45),
  faceVisible: true,
})));

// Run 2: Reading lower UI / looking at bottom questions — y~0.75–0.85 boundary
// This often false-flags "looking_down" when student looks at bottom of exam
const run2Steps = [];
for (let i = 0; i < 15; i++) run2Steps.push({ gaze: gaze(0.5, 0.5), faceVisible: true });
for (let i = 0; i < 25; i++) run2Steps.push({ gaze: gaze(0.5, 0.85), faceVisible: true }); // enter lap zone
for (let i = 0; i < 15; i++) run2Steps.push({ gaze: gaze(0.5, 0.55), faceVisible: true });
const run2 = runScenario('run2_bottom_of_exam_ui', run2Steps);

// Run 3: Brief side glance (2nd monitor peek) then back — may under/over call
const run3Steps = [];
for (let i = 0; i < 10; i++) run3Steps.push({ gaze: gaze(0.5, 0.45), faceVisible: true });
for (let i = 0; i < 12; i++) run3Steps.push({ gaze: gaze(0.01, 0.45), faceVisible: true }); // off screen brief
for (let i = 0; i < 20; i++) run3Steps.push({ gaze: gaze(0.5, 0.45), faceVisible: true });
for (let i = 0; i < 22; i++) run3Steps.push({ gaze: gaze(0.01, 0.45), faceVisible: true }); // sustained
const run3 = runScenario('run3_side_glances', run3Steps);

// Extra probes for known gaps
const runPhone = runScenario('probe_phone_in_lap_gaze_only', [
  ...Array.from({ length: 5 }, () => ({ gaze: gaze(0.5, 0.4), faceVisible: true })),
  ...Array.from({ length: 25 }, () => ({ gaze: gaze(0.5, 0.9), faceVisible: true })),
]);

const runFace = runScenario('probe_face_missing', Array.from({ length: 20 }, () => ({
  gaze: null,
  faceVisible: false,
})));

// Co-occurrence: looking_down + hands.inLap → phone_risk
const runPhoneRiskSteps = [];
for (let i = 0; i < 5; i++) {
  runPhoneRiskSteps.push({ gaze: gaze(0.5, 0.4), faceVisible: true, hands: { inLap: false, count: 0 } });
}
for (let i = 0; i < 22; i++) {
  runPhoneRiskSteps.push({
    gaze: gaze(0.5, 0.9),
    faceVisible: true,
    hands: { inLap: true, count: 1 }
  });
}
const runPhoneRisk = runScenario('probe_phone_risk_cooccurrence', runPhoneRiskSteps);

// Hands alone (eyes on screen) — should not become phone_risk
const runHandsOnlySteps = [];
for (let i = 0; i < 15; i++) {
  runHandsOnlySteps.push({
    gaze: gaze(0.5, 0.45),
    faceVisible: true,
    hands: { inLap: true, count: 2 }
  });
}
const runHandsOnly = runScenario('probe_hands_only', runHandsOnlySteps);

const results = [run1, run2, run3, runPhone, runFace, runPhoneRisk, runHandsOnly];
console.log(JSON.stringify(results, null, 2));
