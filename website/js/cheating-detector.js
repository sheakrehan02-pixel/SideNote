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
 */
(function (global) {
  'use strict';

  var LAP_ENTER_Y = 0.82;
  var LAP_EXIT_Y = 0.74;
  var OFF_ENTER_X = 0.03;
  var OFF_EXIT_X = 0.06;
  var SUSPICIOUS_FRAMES = 20;
  var WARNING_FRAMES = 10;
  var HISTORY_LEN = 40;
  var CLEAN_FRAMES_TO_RESET = 8;

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
  }

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
   * Append hand + co-occurrence reasons.
   * looking_down + hands_in_lap → phone_risk
   */
  CheatingDetector.prototype._appendHandReasons = function (reasons, hands) {
    if (!handsInLap(hands)) return reasons;

    reasons.push('hands_in_lap');
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

    var countDown = this._countReason('looking_down', SUSPICIOUS_FRAMES);
    var countOff = this._countReason('gaze_off_screen', SUSPICIOUS_FRAMES);
    var countFace = this._countReason('face_not_visible', WARNING_FRAMES);
    var warnDown = this._countReason('looking_down', WARNING_FRAMES);
    var warnOff = this._countReason('gaze_off_screen', WARNING_FRAMES);
    var countFaceLong = this._countReason('face_not_visible', SUSPICIOUS_FRAMES);
    var countHands = this._countReason('hands_in_lap', WARNING_FRAMES);
    var countPhone = this._countReason('phone_risk', SUSPICIOUS_FRAMES);
    var warnPhone = this._countReason('phone_risk', WARNING_FRAMES);
    var warnHandsBrief = this._countReason('hands_in_lap', 4);

    var flags = [];
    var flag;
    var phoneMeta = {
      contributing_flags: ['looking_down', 'hands_in_lap'],
      hand_count: handCount(hands)
    };

    // phone_risk first (co-occurrence) — higher severity / priority than looking_down alone
    if (countPhone >= SUSPICIOUS_FRAMES) {
      flag = this._makeFlag('phone_risk', 'suspicious', countPhone, SUSPICIOUS_FRAMES, phoneMeta);
      if (flag) flags.push(flag);
    } else if (warnPhone >= WARNING_FRAMES && reasons.indexOf('phone_risk') >= 0) {
      flag = this._makeFlag('phone_risk', 'warning', warnPhone, WARNING_FRAMES, phoneMeta);
      if (flag) flags.push(flag);
    }

    // looking_down — still emitted as contributing signal; phone_risk sorts above it
    if (countDown >= SUSPICIOUS_FRAMES) {
      flag = this._makeFlag('looking_down', 'suspicious', countDown, SUSPICIOUS_FRAMES);
      if (flag) flags.push(flag);
    } else if (warnDown >= WARNING_FRAMES && reasons.indexOf('looking_down') >= 0) {
      flag = this._makeFlag('looking_down', 'warning', warnDown, WARNING_FRAMES);
      if (flag) flags.push(flag);
    }

    if (countOff >= SUSPICIOUS_FRAMES) {
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
