/**
 * Side Note — Browser proctoring rules (normalized screen zones).
 *
 * update({ gaze, faceVisible, hands?, headPose?, facesCount? })
 *   → { status, messages, color, flags: [{ id, severity, confidence, startedAt, message }] }
 *
 * Uses gaze (x, y) as fraction of viewport — NOT elementFromPoint, which
 * breaks when gaze coordinates are noisy. Zones have hysteresis so brief
 * noise doesn't flip warnings on/off.
 *
 * Co-occurrence: looking_down + hands_in_lap → phone_risk (higher priority).
 *
 * FROZEN (week2_tune, 2026-08-03): do not tweak zone/dwell/phone constants
 * without a new labeled eval — see docs/THRESHOLD_NOTES.md.
 */
(function (global) {
  'use strict';

  // --- FROZEN week2_tune — see docs/THRESHOLD_NOTES.md ---
  // Gaze zones (viewport-normalized). Lap enter above typical exam UI (~0.85).
  var LAP_ENTER_Y = 0.88;
  var LAP_EXIT_Y = 0.80;
  var OFF_ENTER_X = 0.025;
  var OFF_EXIT_X = 0.08;

  // Dwell windows (frames at demo update rate).
  var WARNING_FRAMES = 12;
  var SUSPICIOUS_FRAMES = 22;
  /** Gaze-only looking_down → suspicious (no hands). Longer than co-occurrence phone_risk. */
  var DOWN_ALONE_SUSPICIOUS_FRAMES = 26;
  /** phone_risk (looking_down + hands) escalates a bit sooner — high-value signal. */
  var PHONE_WARNING_FRAMES = 12;
  var PHONE_SUSPICIOUS_FRAMES = 18;
  var HISTORY_LEN = 44;
  var CLEAN_FRAMES_TO_RESET = 6;
  // --- end freeze ---

  var STATUS_COLORS = {
    ok: '#7a9e6a',
    warning: '#c4956a',
    suspicious: '#c46a6a'
  };

  var SEVERITY_RANK = { ok: 0, info: 1, warning: 2, suspicious: 3 };

  /** Higher = preferred “current signal” when severities tie (taxonomy order). */
  var FLAG_PRIORITY = {
    phone_risk: 100,
    looking_down: 50,
    gaze_off_screen: 50,
    face_not_visible: 40,
    hands_in_lap: 30
  };

  /** Taxonomy-aligned copy + base confidence by flag id / severity. */
  var FLAG_COPY = {
    looking_down: {
      warning: {
        message: 'Glanced toward the bottom of the screen',
        baseConfidence: 0.55
      },
      suspicious: {
        message: 'Looking down for a while — phone or notes on your desk?',
        baseConfidence: 0.8
      }
    },
    gaze_off_screen: {
      warning: {
        message: 'Glanced toward the edge of the screen',
        baseConfidence: 0.5
      },
      suspicious: {
        message: 'Gaze off to the side for a while — second screen or device?',
        baseConfidence: 0.78
      }
    },
    face_not_visible: {
      warning: {
        message: 'Cannot see your face — check camera angle and lighting',
        baseConfidence: 0.7
      },
      suspicious: {
        message: 'Face has been missing for a while — check camera',
        baseConfidence: 0.85
      }
    },
    hands_in_lap: {
      info: {
        message: 'Hands briefly left the keyboard area',
        baseConfidence: 0.4
      },
      warning: {
        message: 'Hands appear below the desk line',
        baseConfidence: 0.6
      }
    },
    phone_risk: {
      warning: {
        message: 'Looking down with hands low — keep eyes on the exam',
        baseConfidence: 0.75
      },
      suspicious: {
        message: 'Sustained look down with hands in lap — possible phone or notes',
        baseConfidence: 0.92
      }
    }
  };

  function emptyResult() {
    return { status: 'ok', messages: [], color: STATUS_COLORS.ok, flags: [] };
  }

  function clamp01(n) {
    return Math.max(0, Math.min(1, n));
  }

  function handsInLap(hands) {
    return !!(hands && hands.inLap);
  }

  function handCount(hands) {
    if (!hands) return 0;
    if (typeof hands.count === 'number' && hands.count > 0) return hands.count;
    return hands.inLap ? 1 : 0;
  }

  function CheatingDetector() {
    this.history = [];
    this.events = [];
    this.cleanStreak = 0;
    this.inLapZone = false;
    this.inOffZone = false;
    this.lastSignals = null;
    /** @type {Object.<string, string>} flag id → ISO startedAt while reason is active */
    this.flagStarts = {};
    /** When true, update() does not accumulate history or emit scored flags. */
    this.paused = false;
  }

  CheatingDetector.prototype.pause = function () {
    this.paused = true;
    this.history = [];
    this.flagStarts = {};
    this.cleanStreak = 0;
    this.inLapZone = false;
    this.inOffZone = false;
  };

  CheatingDetector.prototype.resume = function () {
    this.paused = false;
    this.history = [];
    this.flagStarts = {};
    this.cleanStreak = 0;
    this.inLapZone = false;
    this.inOffZone = false;
  };

  CheatingDetector.prototype.isPaused = function () {
    return !!this.paused;
  };

  CheatingDetector.prototype._pushHistory = function (reasons) {
    this.history.push(reasons.slice());
    if (this.history.length > HISTORY_LEN) this.history.shift();
  };

  CheatingDetector.prototype._countReason = function (reason, windowSize) {
    var slice = this.history.slice(-windowSize);
    return slice.filter(function (r) { return r.indexOf(reason) >= 0; }).length;
  };

  CheatingDetector.prototype._zoneReasons = function (x, y) {
    var reasons = [];

    if (!this.inLapZone && y > LAP_ENTER_Y) this.inLapZone = true;
    else if (this.inLapZone && y < LAP_EXIT_Y) this.inLapZone = false;
    if (this.inLapZone) reasons.push('looking_down');

    if (!this.inOffZone && (x < OFF_ENTER_X || x > 1 - OFF_ENTER_X)) this.inOffZone = true;
    else if (this.inOffZone && x > OFF_EXIT_X && x < 1 - OFF_EXIT_X) this.inOffZone = false;
    if (this.inOffZone) reasons.push('gaze_off_screen');

    return reasons;
  };

  /**
   * Head-pose gates (Face Mesh) — reduce gaze-noise FPs without moving zone lines.
   * pitch > 0 ≈ face angled down; yaw magnitude ≈ head turned L/R.
   * When headPose is missing (scripted eval / Mesh down), reasons pass through unchanged.
   */
  var HEAD_PITCH_DENY_DOWN = -0.05;   // clearly looking up / level-up → not lap
  var HEAD_PITCH_CONFIRM_DOWN = 0.07; // clearly chin-down → supports looking_down
  var HEAD_YAW_DENY_OFF = 0.07;       // facing forward → drop edge-gaze flicker

  CheatingDetector.prototype._applyHeadPoseGate = function (reasons, headPose) {
    if (!headPose || typeof headPose.pitch !== 'number') return reasons;

    var out = reasons.slice();
    var pitch = headPose.pitch;
    var yaw = typeof headPose.yaw === 'number' ? headPose.yaw : 0;

    // Gaze drifted to lap zone but head is clearly not looking down → drop
    if (pitch < HEAD_PITCH_DENY_DOWN && out.indexOf('looking_down') >= 0) {
      out = out.filter(function (r) { return r !== 'looking_down'; });
    }

    // Gaze on edge but head still facing the screen → drop off-screen flicker
    if (Math.abs(yaw) < HEAD_YAW_DENY_OFF && out.indexOf('gaze_off_screen') >= 0) {
      out = out.filter(function (r) { return r !== 'gaze_off_screen'; });
    }

    // Strong chin-down while gaze is near lower third but not yet in lap → nudge
    // (helps intermittent looking_down without lowering LAP_ENTER_Y)
    if (
      pitch >= HEAD_PITCH_CONFIRM_DOWN &&
      out.indexOf('looking_down') < 0 &&
      this.lastSignals &&
      this.lastSignals.gaze &&
      typeof this.lastSignals.gaze.y === 'number'
    ) {
      var yNorm = this.lastSignals.gaze.y / (global.innerHeight || 1);
      if (yNorm > 0.72) out.push('looking_down');
    }

    return out;
  };

  /**
   * Append hand + co-occurrence reasons.
   * phone_risk requires BOTH looking_down (lap gaze zone) AND hands_in_lap.
   */
  CheatingDetector.prototype._appendHandReasons = function (reasons, hands) {
    if (!handsInLap(hands)) return reasons;

    reasons.push('hands_in_lap');
    // Co-occurrence only — never emit phone_risk from hands alone
    if (reasons.indexOf('looking_down') >= 0) {
      reasons.push('phone_risk');
    }
    return reasons;
  };

  /**
   * Normalize update() input.
   *
   * Preferred:
   *   update({ gaze, faceVisible, hands?, headPose?, facesCount? })
   *
   * Legacy (still accepted):
   *   update(gaze, faceVisible)
   *
   * hands:     { inLap: boolean, count?: number } | null
   * headPose:  { pitch?: number, yaw?: number, roll?: number } | null
   * facesCount: number | null
   */
  CheatingDetector.prototype._normalizeSignals = function (input, faceVisibleLegacy) {
    if (input && typeof input === 'object' && !Array.isArray(input) &&
        ('gaze' in input || 'faceVisible' in input || 'hands' in input ||
         'headPose' in input || 'facesCount' in input)) {
      return {
        gaze: input.gaze != null ? input.gaze : null,
        faceVisible: input.faceVisible !== false,
        hands: input.hands != null ? input.hands : null,
        headPose: input.headPose != null ? input.headPose : null,
        facesCount: typeof input.facesCount === 'number' ? input.facesCount : null
      };
    }

    return {
      gaze: input != null ? input : null,
      faceVisible: faceVisibleLegacy !== false,
      hands: null,
      headPose: null,
      facesCount: null
    };
  };

  CheatingDetector.prototype._syncFlagStarts = function (reasonIds) {
    var now = new Date().toISOString();
    var active = {};
    var i;
    for (i = 0; i < reasonIds.length; i++) active[reasonIds[i]] = true;

    Object.keys(this.flagStarts).forEach(function (id) {
      if (!active[id]) delete this.flagStarts[id];
    }, this);

    for (i = 0; i < reasonIds.length; i++) {
      if (!this.flagStarts[reasonIds[i]]) this.flagStarts[reasonIds[i]] = now;
    }
  };

  /**
   * Build a taxonomy flag object. One id upgrades severity (no parallel warn/sus ids).
   */
  CheatingDetector.prototype._makeFlag = function (id, severity, frameCount, threshold, meta) {
    var copy = FLAG_COPY[id] && FLAG_COPY[id][severity];
    if (!copy) return null;

    var dwell = threshold > 0 ? frameCount / threshold : 0;
    var confidence = clamp01(copy.baseConfidence + Math.min(0.15, dwell * 0.1));

    // Head-pose agreement bumps confidence on gaze flags
    var pose = this.lastSignals && this.lastSignals.headPose;
    if (pose && typeof pose.pitch === 'number') {
      if (id === 'looking_down' || id === 'phone_risk') {
        if (pose.pitch >= HEAD_PITCH_CONFIRM_DOWN) confidence = clamp01(confidence + 0.08);
        else if (pose.pitch < HEAD_PITCH_DENY_DOWN) confidence = clamp01(confidence - 0.1);
      }
      if (id === 'gaze_off_screen' && typeof pose.yaw === 'number') {
        if (Math.abs(pose.yaw) >= 0.12) confidence = clamp01(confidence + 0.08);
        else if (Math.abs(pose.yaw) < HEAD_YAW_DENY_OFF) confidence = clamp01(confidence - 0.1);
      }
    }

    var flag = {
      id: id,
      severity: severity,
      confidence: Math.round(confidence * 100) / 100,
      startedAt: this.flagStarts[id] || new Date().toISOString(),
      message: copy.message
    };
    if (meta) flag.meta = meta;
    return flag;
  };

  CheatingDetector.prototype.update = function (input, faceVisibleLegacy) {
    if (this.paused) {
      return emptyResult();
    }

    var signals = this._normalizeSignals(input, faceVisibleLegacy);
    this.lastSignals = signals;

    var reasons = [];
    var gaze = signals.gaze;
    var faceVisible = signals.faceVisible;

    if (!faceVisible || !gaze || typeof gaze.x !== 'number' || typeof gaze.y !== 'number') {
      reasons.push('face_not_visible');
      this.cleanStreak = 0;
      this._syncFlagStarts(reasons);
      this._pushHistory(reasons);
      return this._evaluate(reasons, signals);
    }

    var x = gaze.x / global.innerWidth;
    var y = gaze.y / global.innerHeight;

    reasons = this._zoneReasons(x, y);
    // Store gaze on lastSignals early so head-pose nudge can read y
    this.lastSignals = signals;
    reasons = this._applyHeadPoseGate(reasons, signals.headPose);
    this._appendHandReasons(reasons, signals.hands);

    if (!reasons.length) {
      this.cleanStreak += 1;
      if (this.cleanStreak >= CLEAN_FRAMES_TO_RESET) {
        this.history = [];
        this.flagStarts = {};
      }
    } else {
      this.cleanStreak = 0;
    }

    this._syncFlagStarts(reasons);
    this._pushHistory(reasons);
    return this._evaluate(reasons, signals);
  };

  CheatingDetector.prototype._evaluate = function (reasons, signals) {
    if (!reasons.length) {
      return emptyResult();
    }

    signals = signals || this.lastSignals || {};
    var hands = signals.hands;

    var countDown = this._countReason('looking_down', DOWN_ALONE_SUSPICIOUS_FRAMES);
    var countOff = this._countReason('gaze_off_screen', SUSPICIOUS_FRAMES);
    var countFace = this._countReason('face_not_visible', WARNING_FRAMES);
    var warnDown = this._countReason('looking_down', WARNING_FRAMES);
    var warnOff = this._countReason('gaze_off_screen', WARNING_FRAMES);
    var countFaceLong = this._countReason('face_not_visible', SUSPICIOUS_FRAMES);
    var countHands = this._countReason('hands_in_lap', WARNING_FRAMES);
    var countPhone = this._countReason('phone_risk', PHONE_SUSPICIOUS_FRAMES);
    var warnPhone = this._countReason('phone_risk', PHONE_WARNING_FRAMES);
    var warnHandsBrief = this._countReason('hands_in_lap', 4);

    var flags = [];
    var flag;
    var phoneMeta = {
      contributing_flags: ['looking_down', 'hands_in_lap'],
      hand_count: handCount(hands),
      requires: 'looking_down+hands_in_lap'
    };

    // phone_risk first — requires co-occurrence; escalates sooner than gaze-only down
    if (countPhone >= PHONE_SUSPICIOUS_FRAMES) {
      flag = this._makeFlag('phone_risk', 'suspicious', countPhone, PHONE_SUSPICIOUS_FRAMES, phoneMeta);
      if (flag) flags.push(flag);
    } else if (warnPhone >= PHONE_WARNING_FRAMES && reasons.indexOf('phone_risk') >= 0) {
      flag = this._makeFlag('phone_risk', 'warning', warnPhone, PHONE_WARNING_FRAMES, phoneMeta);
      if (flag) flags.push(flag);
    }

    // looking_down — gaze alone needs longer dwell for suspicious; warning uses WARNING_FRAMES
    var headDeniesDown =
      signals.headPose &&
      typeof signals.headPose.pitch === 'number' &&
      signals.headPose.pitch < HEAD_PITCH_DENY_DOWN;
    if (countDown >= DOWN_ALONE_SUSPICIOUS_FRAMES && !headDeniesDown) {
      flag = this._makeFlag('looking_down', 'suspicious', countDown, DOWN_ALONE_SUSPICIOUS_FRAMES);
      if (flag) flags.push(flag);
    } else if (warnDown >= WARNING_FRAMES && reasons.indexOf('looking_down') >= 0) {
      flag = this._makeFlag('looking_down', 'warning', warnDown, WARNING_FRAMES);
      if (flag) flags.push(flag);
    }

    var headDeniesOff =
      signals.headPose &&
      typeof signals.headPose.yaw === 'number' &&
      Math.abs(signals.headPose.yaw) < HEAD_YAW_DENY_OFF;
    if (countOff >= SUSPICIOUS_FRAMES && !headDeniesOff) {
      flag = this._makeFlag('gaze_off_screen', 'suspicious', countOff, SUSPICIOUS_FRAMES);
      if (flag) flags.push(flag);
    } else if (warnOff >= WARNING_FRAMES && reasons.indexOf('gaze_off_screen') >= 0) {
      flag = this._makeFlag('gaze_off_screen', 'warning', warnOff, WARNING_FRAMES);
      if (flag) flags.push(flag);
    }

    if (reasons.indexOf('face_not_visible') >= 0) {
      if (countFaceLong >= SUSPICIOUS_FRAMES) {
        flag = this._makeFlag('face_not_visible', 'suspicious', countFaceLong, SUSPICIOUS_FRAMES);
        if (flag) flags.push(flag);
      } else if (countFace >= WARNING_FRAMES) {
        flag = this._makeFlag('face_not_visible', 'warning', countFace, WARNING_FRAMES);
        if (flag) flags.push(flag);
      }
    }

    // hands alone — info briefly, warning when sustained; rarely the top signal
    if (reasons.indexOf('hands_in_lap') >= 0 && reasons.indexOf('phone_risk') < 0) {
      if (countHands >= WARNING_FRAMES) {
        flag = this._makeFlag('hands_in_lap', 'warning', countHands, WARNING_FRAMES, {
          hand_count: handCount(hands)
        });
        if (flag) flags.push(flag);
      } else if (warnHandsBrief >= 4) {
        flag = this._makeFlag('hands_in_lap', 'info', warnHandsBrief, 4, {
          hand_count: handCount(hands)
        });
        if (flag) flags.push(flag);
      }
    } else if (reasons.indexOf('hands_in_lap') >= 0 && countHands >= WARNING_FRAMES) {
      // Still record hands as contributing when phone_risk is active
      flag = this._makeFlag('hands_in_lap', 'warning', countHands, WARNING_FRAMES, {
        hand_count: handCount(hands)
      });
      if (flag) flags.push(flag);
    }

    if (!flags.length) {
      return emptyResult();
    }

    flags.sort(function (a, b) {
      var d = (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0);
      if (d !== 0) return d;
      d = (FLAG_PRIORITY[b.id] || 0) - (FLAG_PRIORITY[a.id] || 0);
      if (d !== 0) return d;
      return (b.confidence || 0) - (a.confidence || 0);
    });

    var top = flags[0];
    // Overall status follows top flag; info alone does not raise the badge
    var status = top.severity === 'info' ? 'ok' : top.severity;
    return {
      status: status,
      messages: flags
        .filter(function (f) { return f.severity !== 'info' || f.id === top.id; })
        .map(function (f) { return f.message; }),
      color: STATUS_COLORS[status] || STATUS_COLORS.ok,
      flags: flags
    };
  };

  /**
   * Log a non-ok status transition. Prefer passing flags from update().
   * Signature: logEvent(status, messages, flags?)
   */
  CheatingDetector.prototype.logEvent = function (status, messages, flags) {
    if (status === 'ok') return;
    var entry = {
      time: new Date().toISOString(),
      status: status,
      messages: (messages || []).slice(),
      flags: []
    };
    if (flags && flags.length) {
      entry.flags = flags.map(function (f) {
        var out = {
          id: f.id,
          severity: f.severity,
          confidence: f.confidence,
          startedAt: f.startedAt,
          message: f.message
        };
        if (f.meta) out.meta = f.meta;
        return out;
      });
    }
    this.events.push(entry);
  };

  CheatingDetector.prototype.getReport = function () {
    var score = 100;
    var suspicious = 0;
    var warnings = 0;

    this.events.forEach(function (e) {
      var phoneSus = (e.flags || []).some(function (f) {
        return f.id === 'phone_risk' && f.severity === 'suspicious';
      });
      if (phoneSus || e.status === 'suspicious') {
        suspicious += 1;
        score -= phoneSus ? 12 : 8;
      } else if (e.status === 'warning') {
        warnings += 1;
        score -= 2;
      }
    });

    return {
      integrityScore: Math.max(0, score),
      suspiciousCount: suspicious,
      warningCount: warnings,
      events: this.events.slice()
    };
  };

  global.SideNoteCheatingDetector = CheatingDetector;
})(window);
