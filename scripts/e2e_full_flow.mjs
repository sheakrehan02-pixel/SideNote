/**
 * Full student flow ×2 + reviewer session detail.
 * Stubs webcam/WebGazer/calibration (headless has no camera).
 *
 * Usage: node scripts/e2e_full_flow.mjs
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE = process.env.SN_BASE || 'http://127.0.0.1:8000';
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT = path.join(REPO_ROOT, 'data', 'eval', `full_flow_${Date.now()}.json`);

async function installStubs(page) {
  await page.addInitScript(() => {
    // Fake camera stream for anything that asks
    const fakeStream = {
      getVideoTracks: () => [{
        readyState: 'live',
        enabled: true,
        stop: () => {},
        addEventListener: () => {},
        removeEventListener: () => {}
      }],
      getTracks: () => [],
      addEventListener: () => {},
      removeEventListener: () => {}
    };
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = async () => fakeStream;
    }

    window.__SN_E2E__ = true;

    function patchWhenReady() {
      if (!window.SideNoteGaze) {
        setTimeout(patchWhenReady, 50);
        return;
      }
      const G = window.SideNoteGaze;
      G.start = async function (onGaze) {
        G._listener = onGaze || null;
        G._active = true;
        // Deliver calm on-screen gaze samples during exam
        if (G._tick) clearInterval(G._tick);
        G._tick = setInterval(() => {
          if (!G._listener || !G._active) return;
          const x = window.innerWidth * 0.5;
          const y = window.innerHeight * 0.45;
          G._listener({ x, y, raw: { x, y } });
        }, 200);
        return;
      };
      G.stop = function () {
        G._active = false;
        if (G._tick) clearInterval(G._tick);
        G._tick = null;
      };
      G.isCameraLive = () => true;
      G.isActive = () => !!G._active;
      G.isFaceVisible = () => true;
      G.watchCamera = (cb) => { if (typeof cb === 'function') cb(true); };
      G.unwatchCamera = () => {};
      G.styleWebGazerPreview = () => {};
      G.resetSmoothing = () => {};
      G.clearTrainingData = async () => null;
      G.getTrainingPointCount = () => 36;
      G.getPassThresholdPx = () => 180;
      G.runCalibration = async function (overlay, onProgress) {
        if (typeof onProgress === 'function') onProgress(9, 9);
        return {
          pointsCompleted: 9,
          cancelled: false,
          totalSamples: 36,
          trainingPoints: 36
        };
      };
      G.warmupAfterCalibration = async () => null;
      G.runValidation = async () => ({
        errors: [40, 50, 45, 55, 48, 52, 44, 49, 51],
        avgErrorPx: 48,
        passThresholdPx: 180,
        pointsMeasured: 9,
        pointsUnderThreshold: 9,
        passed: true,
        noTracking: false
      });
      window.__SN_GAZE_STUBBED__ = true;
    }
    patchWhenReady();

    // Soft-fail Face/Hands engines
    const noopEngine = {
      start: async () => false,
      stop: () => {},
      isReady: () => false,
      isFaceVisible: () => true,
      getHeadPose: () => null,
      getFacesCount: () => 1,
      getHands: () => ({ inLap: false, count: 0 })
    };
    Object.defineProperty(window, 'SideNoteFace', {
      configurable: true,
      get() { return this.__face || noopEngine; },
      set(v) { this.__face = v; }
    });
    Object.defineProperty(window, 'SideNoteHands', {
      configurable: true,
      get() { return this.__hands || noopEngine; },
      set(v) { this.__hands = v; }
    });
  });
}

async function waitReady(page) {
  await page.waitForFunction(() => {
    return window.__SN_GAZE_STUBBED__ === true &&
      typeof window.SideNoteAPI !== 'undefined' &&
      typeof window.SideNoteCheatingDetector === 'function';
  }, null, { timeout: 20000 });
  // Wait for API health to flip online
  await page.waitForFunction(() => {
    const el = document.getElementById('apiStatus');
    return el && /connected|Offline|session/i.test(el.textContent || '');
  }, null, { timeout: 15000 }).catch(() => {});
}

async function runStudent(page, studentName, answers) {
  const log = { student: studentName, steps: [], sessionId: null, score: null, ok: false };

  await page.goto(BASE + '/demo.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitReady(page);
  log.steps.push('welcome_ready');

  await page.click('#btnStartCamera');
  await page.waitForSelector('#envLighting', { state: 'visible', timeout: 10000 });
  log.steps.push('checklist');

  await page.check('#envLighting');
  await page.check('#envDistance');
  await page.check('#envFullscreen');
  await page.click('#btnReadyChecklist');
  await page.waitForSelector('#btnRunCalibration', { state: 'visible', timeout: 10000 });
  log.steps.push('calibrate');

  await page.click('#btnRunCalibration');
  await page.waitForSelector('#btnAfterCal:not([disabled])', { timeout: 15000 });
  await page.click('#btnAfterCal');
  await page.waitForSelector('#btnRunValidation', { state: 'visible', timeout: 10000 });
  log.steps.push('validate');

  await page.click('#btnRunValidation');
  await page.waitForFunction(() => {
    const el = document.getElementById('validationResult');
    return el && /Passed/i.test(el.textContent || '');
  }, null, { timeout: 20000 });

  // Identity is required to unlock Start exam (along with passed calibration)
  await page.fill('#studentIdentity', studentName);
  await page.dispatchEvent('#studentIdentity', 'input');
  await page.waitForFunction(() => {
    const btn = document.getElementById('btnStartExam');
    return btn && !btn.disabled;
  }, null, { timeout: 10000 });
  await page.click('#btnStartExam');
  await page.waitForSelector('#btnFinishExam', { state: 'visible', timeout: 15000 });
  log.steps.push('exam');

  await page.fill('#q1', answers.q1);
  await page.fill('#q2', answers.q2);
  await page.fill('#q3', answers.q3);

  // Let a few gaze samples land
  await page.waitForTimeout(1200);

  // Inject one soft warning event via detector path if possible
  await page.evaluate(() => {
    // Trigger a brief off-screen sample through gaze listener if present
    if (window.SideNoteGaze && window.SideNoteGaze._listener) {
      window.SideNoteGaze._listener({
        x: window.innerWidth * 0.005,
        y: window.innerHeight * 0.5,
        raw: { x: window.innerWidth * 0.005, y: window.innerHeight * 0.5 }
      });
    }
  });
  await page.waitForTimeout(800);

  await page.click('#btnFinishExam');
  await page.waitForSelector('#integrityScore', { state: 'visible', timeout: 20000 });
  // Wait for report panel content
  await page.waitForTimeout(500);

  const report = await page.evaluate(() => {
    const score = document.getElementById('integrityScore')?.textContent;
    const summary = document.getElementById('reportSummary')?.innerText || '';
    const sidMatch = summary.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return {
      score,
      summary,
      sessionId: sidMatch ? sidMatch[0] : (window.SideNoteAPI && window.SideNoteAPI.getSessionId && window.SideNoteAPI.getSessionId()),
      online: window.SideNoteAPI && window.SideNoteAPI.isOnline && window.SideNoteAPI.isOnline()
    };
  });
  log.score = report.score;
  log.sessionId = report.sessionId;
  log.summarySnippet = (report.summary || '').slice(0, 280);
  log.online = report.online;
  log.steps.push('report');
  log.ok = !!(report.score != null && report.sessionId);
  return log;
}

async function runReviewer(page, sessionId) {
  const log = { role: 'reviewer', sessionId, ok: false, checks: {} };
  await page.goto(BASE + '/sessions.html', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(800);
  log.checks.sessionsStatus = await page.locator('#status').innerText().catch(() => '');

  await page.goto(BASE + '/session.html?id=' + encodeURIComponent(sessionId), {
    waitUntil: 'domcontentloaded',
    timeout: 20000
  });
  await page.waitForSelector('#sessionHero:not([hidden])', { timeout: 15000 });

  const detail = await page.evaluate(() => {
    return {
      student: document.getElementById('sessionStudent')?.textContent,
      title: document.getElementById('sessionTitle')?.textContent,
      score: document.getElementById('scoreValue')?.textContent,
      duration: document.getElementById('metricDuration')?.textContent,
      flags: document.getElementById('metricFlags')?.textContent,
      scoreBreakdown: document.getElementById('sessionScoreBreakdown')?.textContent,
      timelineCount: document.querySelectorAll('#flagTimeline li').length,
      explainVisible: !document.getElementById('scoreExplainPanel')?.hidden,
      disclaimer: document.querySelector('#scoreExplainPanel .report-disclaimer')?.innerText || ''
    };
  });
  log.checks = { ...log.checks, ...detail };
  log.ok = !!(detail.student && detail.score && detail.score !== '—' && detail.explainVisible);
  return log;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: ['camera', 'microphone']
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));

  await installStubs(page);

  const out = {
    at: new Date().toISOString(),
    base: BASE,
    studentRuns: [],
    reviewer: null
  };

  out.studentRuns.push(await runStudent(page, 'Ada Lovelace (E2E-1)', {
    q1: 'Mitochondria',
    q2: 'Plants convert light into chemical energy.',
    q3: 'A T C G'
  }));

  out.studentRuns.push(await runStudent(page, 'Grace Hopper (E2E-2)', {
    q1: 'Mitochondrion',
    q2: 'Photosynthesis makes sugar from CO2 and water using light.',
    q3: 'Adenine, thymine, cytosine, guanine'
  }));

  const reviewId = out.studentRuns.map((r) => r.sessionId).filter(Boolean).pop()
    || out.studentRuns[0].sessionId;

  if (!reviewId) {
    // Fallback: pick newest submitted from API
    const sessions = await page.evaluate(async (base) => {
      const r = await fetch(base + '/api/sessions?limit=20');
      return r.json();
    }, BASE);
    const submitted = (sessions || []).find((s) => s.status === 'submitted' || s.integrity_score != null);
    out.reviewer = submitted
      ? await runReviewer(page, submitted.id)
      : { ok: false, error: 'No session id from student runs' };
  } else {
    out.reviewer = await runReviewer(page, reviewId);
  }

  await browser.close();

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log('\nWrote', OUT);

  const studentsOk = out.studentRuns.every((r) => r.ok);
  const reviewerOk = out.reviewer && out.reviewer.ok;
  process.exit(studentsOk && reviewerOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
