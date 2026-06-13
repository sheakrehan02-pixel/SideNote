/**
 * Side Note — Browser proctoring rules (mirrors main.py logic, screen coordinates).
 */
(function (global) {
  'use strict';

  var LAP_ZONE_Y = 0.72;
  var OFF_SCREEN_X = 0.06;
  var SUSPICIOUS_FRAMES = 18;
  var WARNING_FRAMES = 10;
  var HISTORY_LEN = 30;

  function CheatingDetector() {
    this.history = [];
    this.events = [];
  }

  CheatingDetector.prototype._pushHistory = function (reasons) {
    this.history.push(reasons.slice());
    if (this.history.length > HISTORY_LEN) this.history.shift();
  };

  CheatingDetector.prototype._countReason = function (reason, windowSize) {
    var slice = this.history.slice(-windowSize);
    return slice.filter(function (r) { return r.indexOf(reason) >= 0; }).length;
  };

  CheatingDetector.prototype.update = function (gaze, faceVisible) {
    var reasons = [];
    var w = global.innerWidth;
    var h = global.innerHeight;

    if (!faceVisible || !gaze) {
      reasons.push('face_not_visible');
      this._pushHistory(reasons);
      return this._evaluate(reasons);
    }

    var x = gaze.x / w;
    var y = gaze.y / h;

    if (y > LAP_ZONE_Y) reasons.push('looking_down');
    if (x < OFF_SCREEN_X || x > 1 - OFF_SCREEN_X) reasons.push('gaze_off_screen');

    var el = document.elementFromPoint(gaze.x, gaze.y);
    if (el && !el.closest('#exam-content') && !el.closest('.proctor-panel') && !el.closest('#gazeDot')) {
      reasons.push('outside_exam_area');
    }

    this._pushHistory(reasons);
    return this._evaluate(reasons);
  };

  CheatingDetector.prototype._evaluate = function (reasons) {
    if (!reasons.length) {
      return { status: 'ok', messages: [], color: '#00d4aa' };
    }

    var countDown = this._countReason('looking_down', SUSPICIOUS_FRAMES);
    var countOff = this._countReason('gaze_off_screen', SUSPICIOUS_FRAMES);
    var countOutside = this._countReason('outside_exam_area', SUSPICIOUS_FRAMES);
    var countFace = this._countReason('face_not_visible', WARNING_FRAMES);

    if (countDown >= SUSPICIOUS_FRAMES) {
      return {
        status: 'suspicious',
        messages: ['Sustained look toward lap / desk (possible phone or notes)'],
        color: '#ff4444'
      };
    }
    if (countOff >= SUSPICIOUS_FRAMES) {
      return {
        status: 'suspicious',
        messages: ['Sustained gaze off-screen (possible second monitor or device)'],
        color: '#ff4444'
      };
    }
    if (countOutside >= SUSPICIOUS_FRAMES) {
      return {
        status: 'suspicious',
        messages: ['Attention left the exam content area'],
        color: '#ff4444'
      };
    }

    if (countDown >= WARNING_FRAMES || countOff >= WARNING_FRAMES) {
      return {
        status: 'warning',
        messages: ['Brief look away from exam content'],
        color: '#ffb020'
      };
    }
    if (countFace >= WARNING_FRAMES) {
      return {
        status: 'warning',
        messages: ['Face not visible to camera'],
        color: '#ffb020'
      };
    }

    return { status: 'ok', messages: [], color: '#00d4aa' };
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
