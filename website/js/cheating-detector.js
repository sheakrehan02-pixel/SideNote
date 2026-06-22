/**
 * Side Note — Browser proctoring rules (screen-coordinate gaze zones).
 */
(function (global) {
  'use strict';

  var LAP_ZONE_Y = 0.78;
  var OFF_SCREEN_X = 0.04;
  var SUSPICIOUS_FRAMES = 15;
  var WARNING_FRAMES = 8;
  var HISTORY_LEN = 30;
  var CLEAN_FRAMES_TO_RESET = 5;

  var STATUS_COLORS = {
    ok: '#7a9e6a',
    warning: '#c4956a',
    suspicious: '#c46a6a'
  };

  var IGNORE_SELECTORS = [
    '#exam-content',
    '.proctor-panel',
    '#gazeDot',
    '#calOverlay',
    '#webgazerVideoContainer',
    '#webgazerVideoFeed',
    '#webgazerCanvas',
    '#webgazerFaceOverlay',
    '#webgazerFaceFeedbackBox',
    '#webgazerGazeDot'
  ];

  function CheatingDetector() {
    this.history = [];
    this.events = [];
    this.cleanStreak = 0;
  }

  CheatingDetector.prototype._pushHistory = function (reasons) {
    this.history.push(reasons.slice());
    if (this.history.length > HISTORY_LEN) this.history.shift();
  };

  CheatingDetector.prototype._countReason = function (reason, windowSize) {
    var slice = this.history.slice(-windowSize);
    return slice.filter(function (r) { return r.indexOf(reason) >= 0; }).length;
  };

  CheatingDetector.prototype._isIgnoredElement = function (el) {
    if (!el) return true;
    for (var i = 0; i < IGNORE_SELECTORS.length; i++) {
      if (el.closest(IGNORE_SELECTORS[i])) return true;
    }
    if (el.closest('.cal-backdrop') || el.closest('.top-bar')) return true;
    return false;
  };

  CheatingDetector.prototype.update = function (gaze, faceVisible) {
    var reasons = [];
    var w = global.innerWidth;
    var h = global.innerHeight;

    if (!faceVisible || !gaze || typeof gaze.x !== 'number' || typeof gaze.y !== 'number') {
      reasons.push('face_not_visible');
      this.cleanStreak = 0;
      this._pushHistory(reasons);
      return this._evaluate(reasons);
    }

    var x = gaze.x / w;
    var y = gaze.y / h;

    if (y > LAP_ZONE_Y) reasons.push('looking_down');
    if (x < OFF_SCREEN_X || x > 1 - OFF_SCREEN_X) reasons.push('gaze_off_screen');

    var el = document.elementFromPoint(gaze.x, gaze.y);
    if (el && !this._isIgnoredElement(el)) {
      reasons.push('outside_exam_area');
    }

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
    var countOutside = this._countReason('outside_exam_area', SUSPICIOUS_FRAMES);
    var countFace = this._countReason('face_not_visible', WARNING_FRAMES);
    var warnDown = this._countReason('looking_down', WARNING_FRAMES);
    var warnOff = this._countReason('gaze_off_screen', WARNING_FRAMES);
    var warnOutside = this._countReason('outside_exam_area', WARNING_FRAMES);

    if (countDown >= SUSPICIOUS_FRAMES) {
      return {
        status: 'suspicious',
        messages: ['Looks like you have been looking down for a while — phone or notes on your desk?'],
        color: STATUS_COLORS.suspicious
      };
    }
    if (countOff >= SUSPICIOUS_FRAMES) {
      return {
        status: 'suspicious',
        messages: ['Your gaze has been off to the side for a while — second screen or device?'],
        color: STATUS_COLORS.suspicious
      };
    }
    if (countOutside >= SUSPICIOUS_FRAMES) {
      return {
        status: 'suspicious',
        messages: ['Your attention has been away from the exam for a while'],
        color: STATUS_COLORS.suspicious
      };
    }

    if (reasons.indexOf('face_not_visible') >= 0 && countFace >= WARNING_FRAMES) {
      return {
        status: 'warning',
        messages: ['We cannot see your face — check your camera angle and lighting'],
        color: STATUS_COLORS.warning
      };
    }
    if (warnDown >= WARNING_FRAMES) {
      return {
        status: 'warning',
        messages: ['You glanced toward the bottom of the screen'],
        color: STATUS_COLORS.warning
      };
    }
    if (warnOff >= WARNING_FRAMES) {
      return {
        status: 'warning',
        messages: ['You glanced toward the edge of the screen'],
        color: STATUS_COLORS.warning
      };
    }
    if (warnOutside >= WARNING_FRAMES) {
      return {
        status: 'warning',
        messages: ['Your eyes moved outside the exam area'],
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
