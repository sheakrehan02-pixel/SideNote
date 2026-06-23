/**
 * Side Note — Browser proctoring rules (normalized screen zones).
 *
 * Uses gaze (x, y) as fraction of viewport — NOT elementFromPoint, which
 * breaks when gaze coordinates are noisy. Zones have hysteresis so brief
 * noise doesn't flip warnings on/off.
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

  function CheatingDetector() {
    this.history = [];
    this.events = [];
    this.cleanStreak = 0;
    this.inLapZone = false;
    this.inOffZone = false;
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

  CheatingDetector.prototype.update = function (gaze, faceVisible) {
    var reasons = [];

    if (!faceVisible || !gaze || typeof gaze.x !== 'number' || typeof gaze.y !== 'number') {
      reasons.push('face_not_visible');
      this.cleanStreak = 0;
      this._pushHistory(reasons);
      return this._evaluate(reasons);
    }

    var x = gaze.x / global.innerWidth;
    var y = gaze.y / global.innerHeight;

    reasons = this._zoneReasons(x, y);

    if (!reasons.length) {
      this.cleanStreak += 1;
      if (this.cleanStreak >= CLEAN_FRAMES_TO_RESET) {
        this.history = [];
      }
    } else {
      this.cleanStreak = 0;
    }

    this._pushHistory(reasons);
    return this._evaluate(reasons);
  };

  CheatingDetector.prototype._evaluate = function (reasons) {
    if (!reasons.length) {
      return { status: 'ok', messages: [], color: STATUS_COLORS.ok };
    }

    var countDown = this._countReason('looking_down', SUSPICIOUS_FRAMES);
    var countOff = this._countReason('gaze_off_screen', SUSPICIOUS_FRAMES);
    var countFace = this._countReason('face_not_visible', WARNING_FRAMES);
    var warnDown = this._countReason('looking_down', WARNING_FRAMES);
    var warnOff = this._countReason('gaze_off_screen', WARNING_FRAMES);

    if (countDown >= SUSPICIOUS_FRAMES) {
      return {
        status: 'suspicious',
        messages: ['Looking down for a while — phone or notes on your desk?'],
        color: STATUS_COLORS.suspicious
      };
    }
    if (countOff >= SUSPICIOUS_FRAMES) {
      return {
        status: 'suspicious',
        messages: ['Gaze off to the side for a while — second screen or device?'],
        color: STATUS_COLORS.suspicious
      };
    }

    if (reasons.indexOf('face_not_visible') >= 0 && countFace >= WARNING_FRAMES) {
      return {
        status: 'warning',
        messages: ['Cannot see your face — check camera angle and lighting'],
        color: STATUS_COLORS.warning
      };
    }
    if (warnDown >= WARNING_FRAMES) {
      return {
        status: 'warning',
        messages: ['Glanced toward the bottom of the screen'],
        color: STATUS_COLORS.warning
      };
    }
    if (warnOff >= WARNING_FRAMES) {
      return {
        status: 'warning',
        messages: ['Glanced toward the edge of the screen'],
        color: STATUS_COLORS.warning
      };
    }

    return { status: 'ok', messages: [], color: STATUS_COLORS.ok };
  };

  CheatingDetector.prototype.logEvent = function (status, messages) {
    if (status === 'ok') return;
    this.events.push({
      time: new Date().toISOString(),
      status: status,
      messages: messages.slice()
    });
  };

  CheatingDetector.prototype.getReport = function () {
    var suspicious = this.events.filter(function (e) { return e.status === 'suspicious'; }).length;
    var warnings = this.events.filter(function (e) { return e.status === 'warning'; }).length;
    var score = Math.max(0, 100 - suspicious * 8 - warnings * 2);
    return {
      integrityScore: score,
      suspiciousCount: suspicious,
      warningCount: warnings,
      events: this.events.slice()
    };
  };

  global.SideNoteCheatingDetector = CheatingDetector;
})(window);
