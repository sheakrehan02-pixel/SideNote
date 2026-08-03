/**
 * Day 7 — Week 1 baseline eval (scripted detector measurement).
 *
 * Runs 20 scenario clips through SideNoteCheatingDetector (no webcam),
 * writes data/eval/labels.csv + results_week1.csv, prints precision/recall.
 *
 * Live webcam clips: replace scripted rows with Method A session JSON later
 * (see docs/EVAL_PROTOCOL.md). Tag these rows notes with "scripted".
 *
 * Usage:
 *   node scripts/eval_week1.js              # full 20-clip batch (freeze baseline)
 *   node scripts/eval_week1.js --subset     # Day 14 regression: 10 critical clips
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const EVAL_DIR = path.join(ROOT, 'data', 'eval');
const BATCH_ID = 'w1_scripted_20260802';
const VIEW_W = 1440;
const VIEW_H = 900;

const detectorPath = path.join(ROOT, 'website', 'js', 'cheating-detector.js');
const code = fs.readFileSync(detectorPath, 'utf8');
const sandbox = { innerWidth: VIEW_W, innerHeight: VIEW_H, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const CheatingDetector = sandbox.SideNoteCheatingDetector;
if (!CheatingDetector) {
  console.error('Failed to load SideNoteCheatingDetector');
  process.exit(1);
}

function gaze(nx, ny) {
  return { x: nx * VIEW_W, y: ny * VIEW_H };
}

function frames(n, step) {
  return Array.from({ length: n }, () =>
    typeof step === 'function' ? step() : Object.assign({}, step)
  );
}

function runClip(steps) {
  const d = new CheatingDetector();
  const seen = new Map(); // id -> max severity rank
  const RANK = { info: 1, warning: 2, suspicious: 3 };
  let anyWarning = 0;
  let anySuspicious = 0;
  let warningCount = 0;
  let suspiciousCount = 0;

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const result = d.update({
      gaze: s.gaze,
      faceVisible: s.faceVisible !== false,
      hands: s.hands != null ? s.hands : null,
      headPose: s.headPose != null ? s.headPose : null,
      facesCount: typeof s.facesCount === 'number' ? s.facesCount : null
    });
    const flags = result.flags || [];
    if (result.status === 'warning') {
      anyWarning = 1;
      warningCount += 1;
    }
    if (result.status === 'suspicious') {
      anySuspicious = 1;
      suspiciousCount += 1;
    }
    flags.forEach(function (f) {
      if (!f || !f.id) return;
      const r = RANK[f.severity] || 0;
      if (r < 2) return; // warning+
      const prev = seen.get(f.id) || 0;
      if (r > prev) seen.set(f.id, r);
    });
    if (result.status !== 'ok') {
      d.logEvent(result.status, result.messages, result.flags);
    }
  }

  const report = d.getReport();
  const flagIds = Array.from(seen.keys());
  let topSeverity = 'ok';
  if (anySuspicious) topSeverity = 'suspicious';
  else if (anyWarning || flagIds.length) topSeverity = 'warning';

  return {
    pred_any_warning: anyWarning || (flagIds.length ? 1 : 0),
    pred_any_suspicious: anySuspicious,
    pred_flag_ids: flagIds.join('|'),
    pred_top_severity: topSeverity,
    pred_phone_risk: flagIds.indexOf('phone_risk') >= 0 ? 1 : 0,
    pred_suspicious_count: report.suspiciousCount != null ? report.suspiciousCount : suspiciousCount,
    pred_warning_count: report.warningCount != null ? report.warningCount : warningCount,
    integrity_score: report.integrityScore
  };
}

/** Day 7 plan: 6 normal, 4 looking_down, 4 gaze_off_screen, 4 hands/phone, 2 face_away */
const CLIPS = [
  // —— normal (6) ——
  {
    clip_id: '20260802_normal_01',
    scenario: 'normal',
    duration_s: 45,
    gt_primary_flag: 'none',
    gt_should_suspicious: 0,
    gt_secondary_flags: '',
    notes: 'scripted: calm center gaze',
    steps: function () {
      return frames(50, { gaze: gaze(0.5, 0.45), faceVisible: true, hands: { inLap: false, count: 0 } });
    }
  },
  {
    clip_id: '20260802_normal_02',
    scenario: 'normal',
    duration_s: 40,
    gt_primary_flag: 'none',
    gt_should_suspicious: 0,
    gt_secondary_flags: '',
    notes: 'scripted: mid-page reading y=0.55',
    steps: function () {
      return frames(45, { gaze: gaze(0.48, 0.55), faceVisible: true, hands: { inLap: false, count: 0 } });
    }
  },
  {
    clip_id: '20260802_normal_03',
    scenario: 'normal',
    duration_s: 50,
    gt_primary_flag: 'none',
    gt_should_suspicious: 0,
    gt_secondary_flags: '',
    notes: 'scripted: lower exam UI y=0.85 (known FP risk)',
    steps: function () {
      return []
        .concat(frames(10, { gaze: gaze(0.5, 0.5), faceVisible: true, hands: { inLap: false, count: 0 } }))
        .concat(frames(30, { gaze: gaze(0.5, 0.85), faceVisible: true, hands: { inLap: false, count: 0 } }))
        .concat(frames(10, { gaze: gaze(0.5, 0.5), faceVisible: true, hands: { inLap: false, count: 0 } }));
    }
  },
  {
    clip_id: '20260802_normal_04',
    scenario: 'normal',
    duration_s: 40,
    gt_primary_flag: 'none',
    gt_should_suspicious: 0,
    gt_secondary_flags: '',
    notes: 'scripted: brief edge glance then back (should not be suspicious)',
    steps: function () {
      return []
        .concat(frames(15, { gaze: gaze(0.5, 0.45), faceVisible: true, hands: { inLap: false, count: 0 } }))
        .concat(frames(6, { gaze: gaze(0.01, 0.45), faceVisible: true, hands: { inLap: false, count: 0 } }))
        .concat(frames(20, { gaze: gaze(0.5, 0.45), faceVisible: true, hands: { inLap: false, count: 0 } }));
    }
  },
  {
    clip_id: '20260802_normal_05',
    scenario: 'normal',
    duration_s: 45,
    gt_primary_flag: 'none',
    gt_should_suspicious: 0,
    gt_secondary_flags: '',
    notes: 'scripted: typing — small gaze drift in content band',
    steps: function () {
      const out = [];
      for (let i = 0; i < 45; i++) {
        out.push({
          gaze: gaze(0.4 + (i % 5) * 0.04, 0.4 + (i % 3) * 0.05),
          faceVisible: true,
          hands: { inLap: false, count: 0 }
        });
      }
      return out;
    }
  },
  {
    clip_id: '20260802_normal_06',
    scenario: 'normal',
    duration_s: 40,
    gt_primary_flag: 'none',
    gt_should_suspicious: 0,
    gt_secondary_flags: '',
    notes: 'scripted: upper third reading',
    steps: function () {
      return frames(40, { gaze: gaze(0.52, 0.28), faceVisible: true, hands: { inLap: false, count: 0 } });
    }
  },

  // —— looking_down (4) ——
  {
    clip_id: '20260802_looking_down_01',
    scenario: 'looking_down',
    duration_s: 50,
    gt_primary_flag: 'looking_down',
    gt_should_suspicious: 1,
    gt_secondary_flags: '',
    notes: 'scripted: sustained lap-zone gaze, hands on keyboard',
    steps: function () {
      return []
        .concat(frames(8, { gaze: gaze(0.5, 0.45), faceVisible: true, hands: { inLap: false, count: 0 } }))
        .concat(frames(30, { gaze: gaze(0.5, 0.92), faceVisible: true, hands: { inLap: false, count: 0 } }));
    }
  },
  {
    clip_id: '20260802_looking_down_02',
    scenario: 'looking_down',
    duration_s: 45,
    gt_primary_flag: 'looking_down',
    gt_should_suspicious: 1,
    gt_secondary_flags: '',
    notes: 'scripted: repeated down glances',
    steps: function () {
      const out = [];
      for (let cycle = 0; cycle < 3; cycle++) {
        for (let i = 0; i < 8; i++) out.push({ gaze: gaze(0.5, 0.45), faceVisible: true, hands: { inLap: false, count: 0 } });
        for (let i = 0; i < 12; i++) out.push({ gaze: gaze(0.5, 0.9), faceVisible: true, hands: { inLap: false, count: 0 } });
      }
      return out;
    }
  },
  {
    clip_id: '20260802_looking_down_03',
    scenario: 'looking_down',
    duration_s: 50,
    gt_primary_flag: 'looking_down',
    gt_should_suspicious: 1,
    gt_secondary_flags: '',
    notes: 'scripted: phone in lap eyes down (no hands signal)',
    steps: function () {
      return frames(30, { gaze: gaze(0.48, 0.94), faceVisible: true, hands: { inLap: false, count: 0 } });
    }
  },
  {
    clip_id: '20260802_looking_down_04',
    scenario: 'looking_down',
    duration_s: 40,
    gt_primary_flag: 'looking_down',
    gt_should_suspicious: 1,
    gt_secondary_flags: '',
    notes: 'scripted: notes on desk — sustained down',
    steps: function () {
      return []
        .concat(frames(5, { gaze: gaze(0.5, 0.4), faceVisible: true, hands: { inLap: false, count: 0 } }))
        .concat(frames(28, { gaze: gaze(0.55, 0.91), faceVisible: true, hands: { inLap: false, count: 0 } }));
    }
  },

  // —— gaze_off_screen (4) ——
  {
    clip_id: '20260802_gaze_off_screen_01',
    scenario: 'gaze_off_screen',
    duration_s: 50,
    gt_primary_flag: 'gaze_off_screen',
    gt_should_suspicious: 1,
    gt_secondary_flags: '',
    notes: 'scripted: sustained left second-monitor',
    steps: function () {
      return []
        .concat(frames(8, { gaze: gaze(0.5, 0.45), faceVisible: true, hands: { inLap: false, count: 0 } }))
        .concat(frames(28, { gaze: gaze(0.01, 0.45), faceVisible: true, hands: { inLap: false, count: 0 } }));
    }
  },
  {
    clip_id: '20260802_gaze_off_screen_02',
    scenario: 'gaze_off_screen',
    duration_s: 45,
    gt_primary_flag: 'gaze_off_screen',
    gt_should_suspicious: 1,
    gt_secondary_flags: '',
    notes: 'scripted: sustained right edge',
    steps: function () {
      return frames(28, { gaze: gaze(0.99, 0.5), faceVisible: true, hands: { inLap: false, count: 0 } });
    }
  },
  {
    clip_id: '20260802_gaze_off_screen_03',
    scenario: 'gaze_off_screen',
    duration_s: 50,
    gt_primary_flag: 'gaze_off_screen',
    gt_should_suspicious: 1,
    gt_secondary_flags: '',
    notes: 'scripted: side look with return then long again',
    steps: function () {
      return []
        .concat(frames(10, { gaze: gaze(0.5, 0.45), faceVisible: true, hands: { inLap: false, count: 0 } }))
        .concat(frames(12, { gaze: gaze(0.01, 0.4), faceVisible: true, hands: { inLap: false, count: 0 } }))
        .concat(frames(8, { gaze: gaze(0.5, 0.45), faceVisible: true, hands: { inLap: false, count: 0 } }))
        .concat(frames(22, { gaze: gaze(0.01, 0.42), faceVisible: true, hands: { inLap: false, count: 0 } }));
    }
  },
  {
    clip_id: '20260802_gaze_off_screen_04',
    scenario: 'gaze_off_screen',
    duration_s: 40,
    gt_primary_flag: 'gaze_off_screen',
    gt_should_suspicious: 1,
    gt_secondary_flags: '',
    notes: 'scripted: far left sustained',
    steps: function () {
      return frames(26, { gaze: gaze(0.005, 0.48), faceVisible: true, hands: { inLap: false, count: 0 } });
    }
  },

  // —— hands_in_lap / phone_risk (4) ——
  {
    clip_id: '20260802_hands_in_lap_01',
    scenario: 'hands_in_lap',
    duration_s: 40,
    gt_primary_flag: 'hands_in_lap',
    gt_should_suspicious: 0,
    gt_secondary_flags: '',
    notes: 'scripted: hands in lap, eyes on screen (warning ok, not suspicious)',
    steps: function () {
      return frames(25, {
        gaze: gaze(0.5, 0.45),
        faceVisible: true,
        hands: { inLap: true, count: 2 }
      });
    }
  },
  {
    clip_id: '20260802_hands_in_lap_02',
    scenario: 'hands_in_lap',
    duration_s: 40,
    gt_primary_flag: 'hands_in_lap',
    gt_should_suspicious: 0,
    gt_secondary_flags: '',
    notes: 'scripted: hands low, eyes mid-screen',
    steps: function () {
      return frames(22, {
        gaze: gaze(0.5, 0.5),
        faceVisible: true,
        hands: { inLap: true, count: 1 }
      });
    }
  },
  {
    clip_id: '20260802_phone_risk_01',
    scenario: 'phone_risk',
    duration_s: 50,
    gt_primary_flag: 'phone_risk',
    gt_should_suspicious: 1,
    gt_secondary_flags: 'looking_down|hands_in_lap',
    notes: 'scripted: looking_down + hands.inLap co-occurrence',
    steps: function () {
      return []
        .concat(frames(5, { gaze: gaze(0.5, 0.4), faceVisible: true, hands: { inLap: false, count: 0 } }))
        .concat(frames(25, { gaze: gaze(0.5, 0.92), faceVisible: true, hands: { inLap: true, count: 1 } }));
    }
  },
  {
    clip_id: '20260802_phone_risk_02',
    scenario: 'phone_risk',
    duration_s: 50,
    gt_primary_flag: 'phone_risk',
    gt_should_suspicious: 1,
    gt_secondary_flags: 'looking_down|hands_in_lap',
    notes: 'scripted: sustained phone_risk pattern',
    steps: function () {
      return frames(28, {
        gaze: gaze(0.52, 0.9),
        faceVisible: true,
        hands: { inLap: true, count: 2 }
      });
    }
  },

  // —— face_away (2) ——
  {
    clip_id: '20260802_face_away_01',
    scenario: 'face_away',
    duration_s: 40,
    gt_primary_flag: 'face_not_visible',
    gt_should_suspicious: 1,
    gt_secondary_flags: '',
    notes: 'scripted: leave frame / cover cam sustained',
    steps: function () {
      return []
        .concat(frames(5, { gaze: gaze(0.5, 0.45), faceVisible: true, hands: { inLap: false, count: 0 } }))
        .concat(frames(28, { gaze: null, faceVisible: false, hands: null }));
    }
  },
  {
    clip_id: '20260802_face_away_02',
    scenario: 'face_away',
    duration_s: 35,
    gt_primary_flag: 'face_not_visible',
    gt_should_suspicious: 1,
    gt_secondary_flags: '',
    notes: 'scripted: face missing ~25 frames',
    steps: function () {
      return frames(25, { gaze: null, faceVisible: false, hands: null });
    }
  }
];

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function writeCsv(filePath, headers, rows) {
  const lines = [headers.join(',')];
  rows.forEach(function (row) {
    lines.push(headers.map(function (h) { return csvEscape(row[h]); }).join(','));
  });
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

function score(labels, results) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  let fpNormal = 0;
  let normalN = 0;
  const byFlag = {};

  function ensureFlag(id) {
    if (!byFlag[id]) byFlag[id] = { tp: 0, fp: 0, fn: 0 };
  }

  for (let i = 0; i < labels.length; i++) {
    const gt = labels[i];
    const pred = results[i];
    const gtSus = Number(gt.gt_should_suspicious) === 1;
    const predSus = Number(pred.pred_any_suspicious) === 1;

    if (gtSus && predSus) tp += 1;
    else if (!gtSus && predSus) fp += 1;
    else if (gtSus && !predSus) fn += 1;
    else tn += 1;

    if (gt.scenario === 'normal') {
      normalN += 1;
      if (predSus) fpNormal += 1;
    }

    const predIds = (pred.pred_flag_ids || '').split('|').filter(Boolean);
    const secondary = (gt.gt_secondary_flags || '').split('|').filter(Boolean);
    const primary = gt.gt_primary_flag;

    if (primary && primary !== 'none') {
      ensureFlag(primary);
      if (predIds.indexOf(primary) >= 0) byFlag[primary].tp += 1;
      else byFlag[primary].fn += 1;
    }

    predIds.forEach(function (id) {
      if (id === primary) return;
      if (secondary.indexOf(id) >= 0) return;
      if (primary === 'none' || primary !== id) {
        ensureFlag(id);
        byFlag[id].fp += 1;
      }
    });
  }

  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const f1 =
    precision != null && recall != null && precision + recall
      ? (2 * precision * recall) / (precision + recall)
      : null;

  return {
    tp, fp, fn, tn,
    precision, recall, f1,
    fpNormal, normalN,
    byFlag
  };
}

function pct(x) {
  return x == null || Number.isNaN(x) ? 'n/a' : (100 * x).toFixed(1) + '%';
}

/** Day 14 smoke subset — covers FP risk, known FN, phone_risk, off-screen, face, hands */
const DAY14_SUBSET_IDS = [
  '20260802_normal_01',
  '20260802_normal_03',
  '20260802_normal_04',
  '20260802_looking_down_01',
  '20260802_looking_down_02',
  '20260802_looking_down_03',
  '20260802_gaze_off_screen_01',
  '20260802_hands_in_lap_01',
  '20260802_phone_risk_01',
  '20260802_face_away_01'
];

/** Day 10 / week2_tune freeze targets (full 20-clip batch) */
const FREEZE_FULL = {
  tag: 'week2_tune',
  precision: 1,
  recall: 0.9166666666666666,
  f1: 0.9565217391304348,
  fpNormal: 0,
  normalN: 6,
  tp: 11,
  fp: 0,
  fn: 1,
  tn: 8
};

function main() {
  const subset = process.argv.indexOf('--subset') >= 0;
  if (!fs.existsSync(EVAL_DIR)) fs.mkdirSync(EVAL_DIR, { recursive: true });
  const clipsDir = path.join(EVAL_DIR, 'clips');
  if (!fs.existsSync(clipsDir)) fs.mkdirSync(clipsDir, { recursive: true });

  const clips = subset
    ? CLIPS.filter(function (c) { return DAY14_SUBSET_IDS.indexOf(c.clip_id) >= 0; })
    : CLIPS;

  if (subset && clips.length !== DAY14_SUBSET_IDS.length) {
    console.error('Subset clip mismatch: found ' + clips.length + ' / ' + DAY14_SUBSET_IDS.length);
    process.exit(1);
  }

  const labelRows = [];
  const resultRows = [];

  clips.forEach(function (clip) {
    const pred = runClip(clip.steps());
    const label = {
      clip_id: clip.clip_id,
      batch_id: BATCH_ID,
      scenario: clip.scenario,
      duration_s: clip.duration_s,
      gt_primary_flag: clip.gt_primary_flag,
      gt_should_suspicious: clip.gt_should_suspicious,
      gt_secondary_flags: clip.gt_secondary_flags,
      cal_avg_error_px: 120,
      cal_passed: 1,
      notes: clip.notes
    };

    const predIds = (pred.pred_flag_ids || '').split('|').filter(Boolean);
    const matchPrimary =
      (clip.gt_primary_flag === 'none' && !pred.pred_any_suspicious) ||
      (clip.gt_primary_flag !== 'none' && predIds.indexOf(clip.gt_primary_flag) >= 0)
        ? 1
        : 0;
    const matchSuspicious =
      Number(clip.gt_should_suspicious) === Number(pred.pred_any_suspicious) ? 1 : 0;
    const falseSuspicious =
      pred.pred_any_suspicious && !clip.gt_should_suspicious ? 1 : 0;

    labelRows.push(label);
    resultRows.push({
      clip_id: clip.clip_id,
      pred_any_warning: pred.pred_any_warning,
      pred_any_suspicious: pred.pred_any_suspicious,
      pred_flag_ids: pred.pred_flag_ids,
      pred_top_severity: pred.pred_top_severity,
      pred_phone_risk: pred.pred_phone_risk,
      pred_suspicious_count: pred.pred_suspicious_count,
      pred_warning_count: pred.pred_warning_count,
      integrity_score: pred.integrity_score,
      match_primary: matchPrimary,
      match_suspicious: matchSuspicious,
      false_suspicious: falseSuspicious,
      notes: clip.notes
    });
  });

  const labelHeaders = [
    'clip_id', 'batch_id', 'scenario', 'duration_s', 'gt_primary_flag',
    'gt_should_suspicious', 'gt_secondary_flags', 'cal_avg_error_px', 'cal_passed', 'notes'
  ];
  const resultHeaders = [
    'clip_id', 'pred_any_warning', 'pred_any_suspicious', 'pred_flag_ids',
    'pred_top_severity', 'pred_phone_risk', 'pred_suspicious_count', 'pred_warning_count',
    'integrity_score', 'match_primary', 'match_suspicious', 'false_suspicious', 'notes'
  ];

  const resultsName = subset ? 'results_day14_subset.csv' : 'results_week1.csv';
  const summaryName = subset ? 'day14_subset_summary.json' : 'week1_summary.json';
  if (!subset) {
    writeCsv(path.join(EVAL_DIR, 'labels.csv'), labelHeaders, labelRows);
  }
  writeCsv(path.join(EVAL_DIR, resultsName), resultHeaders, resultRows);

  const m = score(labelRows, resultRows);
  const phone = m.byFlag.phone_risk || { tp: 0, fp: 0, fn: 0 };
  const phoneP = phone.tp + phone.fp ? phone.tp / (phone.tp + phone.fp) : null;
  const phoneR = phone.tp + phone.fn ? phone.tp / (phone.tp + phone.fn) : null;

  const today = new Date().toISOString().slice(0, 10);
  const summary = {
    date: today,
    tag: subset ? 'day14_subset' : 'week2_tune',
    batch_id: BATCH_ID,
    method: 'scripted_detector',
    subset: subset ? DAY14_SUBSET_IDS : null,
    tune_note:
      'LAP_ENTER 0.88/0.80; WARNING 12; DOWN_ALONE_SUS 26; PHONE_SUS 18; wrist abs 0.58/0.50 rel 0.22/0.10',
    clips: labelRows.length,
    suspicious: {
      tp: m.tp, fp: m.fp, fn: m.fn, tn: m.tn,
      precision: m.precision,
      recall: m.recall,
      f1: m.f1
    },
    phone_risk: { tp: phone.tp, fp: phone.fp, fn: phone.fn, precision: phoneP, recall: phoneR },
    false_suspicious_on_normal: m.fpNormal + ' / ' + m.normalN,
    by_flag: m.byFlag,
    biggest_failure_mode:
      'Intermittent looking_down bursts stay at warning (never reach DOWN_ALONE_SUSPICIOUS_FRAMES=26); lower-exam-UI false suspicious is fixed by LAP_ENTER_Y=0.88.'
  };

  // Row-level regression vs frozen results_week1.csv (notes may be quoted)
  function parseResultCsvLine(line) {
    const cols = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else if (ch === '"') {
          inQ = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQ = true;
      } else if (ch === ',') {
        cols.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    cols.push(cur);
    return {
      clip_id: cols[0],
      pred_any_suspicious: cols[2],
      pred_flag_ids: cols[3] || '',
      pred_top_severity: cols[4],
      pred_phone_risk: cols[5],
      false_suspicious: cols[11]
    };
  }

  const freezePath = path.join(EVAL_DIR, 'results_week1.csv');
  let regressions = [];
  if (fs.existsSync(freezePath)) {
    const freezeLines = fs.readFileSync(freezePath, 'utf8').trim().split('\n');
    const freezeById = {};
    for (let i = 1; i < freezeLines.length; i++) {
      const prev = parseResultCsvLine(freezeLines[i]);
      freezeById[prev.clip_id] = prev;
    }
    resultRows.forEach(function (row) {
      const prev = freezeById[row.clip_id];
      if (!prev) {
        regressions.push(row.clip_id + ': missing from freeze CSV');
        return;
      }
      const checks = [
        ['pred_any_suspicious', String(row.pred_any_suspicious), String(prev.pred_any_suspicious)],
        ['pred_top_severity', String(row.pred_top_severity), String(prev.pred_top_severity)],
        ['pred_phone_risk', String(row.pred_phone_risk), String(prev.pred_phone_risk)],
        ['false_suspicious', String(row.false_suspicious), String(prev.false_suspicious)]
      ];
      checks.forEach(function (c) {
        if (c[1] !== c[2]) {
          regressions.push(row.clip_id + ': ' + c[0] + ' ' + c[2] + ' → ' + c[1]);
        }
      });
      const a = (row.pred_flag_ids || '').split('|').filter(Boolean).sort().join('|');
      const b = (prev.pred_flag_ids || '').split('|').filter(Boolean).sort().join('|');
      if (a !== b) {
        regressions.push(row.clip_id + ': pred_flag_ids ' + b + ' → ' + a);
      }
    });
  }

  let freezeOk = null;
  if (!subset) {
    freezeOk =
      m.tp === FREEZE_FULL.tp &&
      m.fp === FREEZE_FULL.fp &&
      m.fn === FREEZE_FULL.fn &&
      m.tn === FREEZE_FULL.tn &&
      m.fpNormal === FREEZE_FULL.fpNormal &&
      Math.abs(m.precision - FREEZE_FULL.precision) < 1e-9 &&
      Math.abs(m.recall - FREEZE_FULL.recall) < 1e-9 &&
      Math.abs(m.f1 - FREEZE_FULL.f1) < 1e-9;
    summary.day10_freeze_match = freezeOk;
    summary.regressions_vs_results_csv = regressions;
  } else {
    summary.regressions_vs_results_csv = regressions;
    summary.day10_row_match = regressions.length === 0;
    // Subset sanity: no new FPs; known FN looking_down_02 still warning-only
    const ld02 = resultRows.find(function (r) { return r.clip_id === '20260802_looking_down_02'; });
    const normalFp = resultRows.filter(function (r) {
      return r.clip_id.indexOf('_normal_') >= 0 && Number(r.pred_any_suspicious) === 1;
    });
    summary.subset_gates = {
      no_false_suspicious_on_normals: normalFp.length === 0,
      looking_down_02_still_fn_warning: ld02 && Number(ld02.pred_any_suspicious) === 0 && ld02.pred_top_severity === 'warning',
      phone_risk_still_fires: resultRows.some(function (r) {
        return r.clip_id === '20260802_phone_risk_01' && Number(r.pred_phone_risk) === 1;
      })
    };
    const g = summary.subset_gates;
    summary.subset_pass =
      g.no_false_suspicious_on_normals &&
      g.looking_down_02_still_fn_warning &&
      g.phone_risk_still_fires &&
      regressions.length === 0;
  }

  fs.writeFileSync(
    path.join(EVAL_DIR, summaryName),
    JSON.stringify(summary, null, 2) + '\n',
    'utf8'
  );

  console.log((subset ? 'Day 14 subset eval' : 'Full Week 1 / Day 10 freeze eval') + ' — ' + BATCH_ID);
  console.log('Clips: ' + labelRows.length + (subset ? ' (subset)' : ''));
  console.log('Suspicious  P/R/F1: ' + pct(m.precision) + ' / ' + pct(m.recall) + ' / ' + pct(m.f1));
  console.log('  TP=' + m.tp + ' FP=' + m.fp + ' FN=' + m.fn + ' TN=' + m.tn);
  console.log('phone_risk  P/R: ' + pct(phoneP) + ' / ' + pct(phoneR) +
    ' (TP=' + phone.tp + ' FP=' + phone.fp + ' FN=' + phone.fn + ')');
  console.log('False suspicious on normal: ' + m.fpNormal + ' / ' + m.normalN);
  if (!subset) {
    console.log('Day 10 freeze match (P100/R91.7/F195.7, FP_normal 0/6): ' + (freezeOk ? 'PASS' : 'FAIL'));
  } else {
    const gates = summary.subset_gates || {};
    console.log('Row match vs frozen results_week1.csv: ' +
      (regressions.length === 0 ? 'PASS (0 diffs)' : 'FAIL (' + regressions.length + ' diffs)'));
    console.log('Subset gates: ' + JSON.stringify(gates) + ' → ' + (summary.subset_pass ? 'PASS' : 'FAIL'));
  }
  if (regressions.length) {
    regressions.forEach(function (r) { console.log('  REGRESS: ' + r); });
  }
  console.log('Wrote ' + (subset ? '' : 'labels.csv, ') + resultsName + ', ' + summaryName);
  console.log('Biggest failure mode: ' + summary.biggest_failure_mode);

  const failed =
    (!subset && !freezeOk) ||
    (subset && !(summary.subset_pass));
  if (failed) {
    process.exit(2);
  }
}

main();
