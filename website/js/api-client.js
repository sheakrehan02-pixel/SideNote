/**
 * Side Note — Backend API client (FastAPI).
 * Demo runs fully offline; persistence is best-effort when the server is up.
 */
(function (global) {
  'use strict';

  var sessionId = null;
  var pendingCalibration = null;
  var backendOnline = false;
  var healthTimer = null;
  var onlineListeners = [];
  var lastNotifiedOnline = null;

  function baseUrl() {
    if (global.SIDE_NOTE_API_URL) return global.SIDE_NOTE_API_URL.replace(/\/$/, '');
    return '';
  }

  function notifyOnlineChange() {
    if (lastNotifiedOnline === backendOnline) return;
    lastNotifiedOnline = backendOnline;
    onlineListeners.forEach(function (fn) {
      try { fn(backendOnline); } catch (e) {}
    });
  }

  function setOnline(online) {
    backendOnline = !!online;
    notifyOnlineChange();
  }

  function markOnline() {
    setOnline(true);
  }

  function markOffline() {
    setOnline(false);
  }

  function request(path, options) {
    options = options || {};
    var url = baseUrl() + path;
    return fetch(url, {
      method: options.method || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, options.headers || {}),
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          var err = new Error(data.detail || res.statusText || 'Request failed');
          err.status = res.status;
          // 5xx → treat as offline for banner purposes
          if (res.status >= 500) markOffline();
          throw err;
        });
      }
      markOnline();
      if (res.status === 204) return null;
      return res.json();
    }).catch(function (err) {
      // Network failure / CORS / server down
      if (!err || err.status == null || err.status >= 500) {
        markOffline();
      }
      throw err;
    });
  }

  function checkHealth() {
    return request('/api/health')
      .then(function (data) {
        var ok = !!(data && data.status === 'ok');
        setOnline(ok);
        return ok;
      })
      .catch(function () {
        markOffline();
        return false;
      });
  }

  function startHealthMonitor(onChange) {
    if (typeof onChange === 'function' && onlineListeners.indexOf(onChange) < 0) {
      onlineListeners.push(onChange);
    }
    if (healthTimer) {
      // Already polling — push current known state to the new listener
      if (typeof onChange === 'function' && lastNotifiedOnline != null) {
        try { onChange(backendOnline); } catch (e) {}
      }
      return;
    }
    function poll() {
      checkHealth();
    }
    poll();
    healthTimer = global.setInterval(poll, 5000);
  }

  function stopHealthMonitor() {
    if (healthTimer) {
      global.clearInterval(healthTimer);
      healthTimer = null;
    }
    onlineListeners = [];
    lastNotifiedOnline = null;
  }

  /**
   * Canonical calibration payload for create/submit/calibration endpoints.
   * { avg_error_px, passed, points }
   */
  function normalizeCalibration(cal) {
    if (!cal) return null;
    var points = cal.points;
    if (points == null) points = cal.points_completed;
    if (points == null) points = 0;
    return {
      avg_error_px: cal.avg_error_px != null ? cal.avg_error_px : null,
      passed: !!cal.passed,
      points: points,
      pass_threshold_px: cal.pass_threshold_px != null ? cal.pass_threshold_px : null,
      training_samples: cal.training_samples != null ? cal.training_samples : null,
      cancelled: !!cal.cancelled
    };
  }

  function createSession(studentName, calibration) {
    var cal = normalizeCalibration(calibration != null ? calibration : pendingCalibration);
    return request('/api/sessions', {
      method: 'POST',
      body: {
        student_name: studentName || null,
        exam_id: 'practice-biology',
        calibration: cal
      }
    }).then(function (data) {
      sessionId = data.id;
      if (cal) pendingCalibration = cal;
      return data;
    });
  }

  /**
   * Persist calibration. If session does not exist yet, stash and no-op until
   * createSession — then flush. Fixes early-null sessionId during validation.
   */
  function saveCalibration(calibration) {
    var cal = normalizeCalibration(calibration);
    pendingCalibration = cal;
    if (!sessionId) return Promise.resolve({ queued: true, calibration: cal });
    if (!backendOnline) return Promise.resolve({ queued: true, calibration: cal, offline: true });
    return request('/api/sessions/' + sessionId + '/calibration', {
      method: 'POST',
      body: cal
    }).catch(function (err) {
      console.warn('Calibration save failed:', err.message);
      return null;
    });
  }

  function ensureSession(studentName, calibration) {
    var cal = normalizeCalibration(calibration != null ? calibration : pendingCalibration);
    var name = studentName ? String(studentName).trim() : null;

    if (!backendOnline) {
      // Soft-fail offline: stash calibration locally, never block the demo.
      if (cal) pendingCalibration = cal;
      return Promise.resolve(null);
    }

    if (sessionId) {
      var tasks = [];
      if (cal) {
        tasks.push(
          request('/api/sessions/' + sessionId + '/calibration', {
            method: 'POST',
            body: cal
          }).catch(function () { return null; })
        );
      }
      if (name) {
        tasks.push(
          request('/api/sessions/' + sessionId + '/identity', {
            method: 'POST',
            body: { student_name: name }
          }).catch(function () { return null; })
        );
      }
      return Promise.all(tasks).then(function () {
        return { id: sessionId, student_name: name };
      });
    }
    return createSession(name, cal).catch(function (err) {
      console.warn('Session create failed (demo continues offline):', err && err.message);
      markOffline();
      return null;
    });
  }

  /**
   * Build POST /events body in the taxonomy-aligned shape.
   *
   * Accepted inputs:
   *   normalizeEvent({ status, flag_id, severity, confidence, messages, evidence_path, flags? })
   *   normalizeEvent(status, messages, extras)   // legacy
   *
   * Always returns:
   *   { status, messages, flag_id?, severity?, confidence?, evidence_path? }
   */
  function normalizeEvent(input, messages, extras) {
    var src = {};
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      src = input;
      extras = messages && typeof messages === 'object' ? messages : {};
    } else {
      src = {
        status: input,
        messages: messages,
        flag_id: extras && extras.flag_id,
        severity: extras && extras.severity,
        confidence: extras && extras.confidence,
        evidence_path: extras && extras.evidence_path,
        flags: extras && extras.flags
      };
      extras = extras || {};
    }

    var status = src.status || extras.status || null;
    var flags = Array.isArray(src.flags) ? src.flags : [];
    var top = flags[0] || null;

    var flagId = src.flag_id || src.flagId || (top && (top.id || top.flag_id)) || extras.flag_id || null;
    var severity = src.severity || (top && top.severity) || extras.severity || status || null;

    var confidence = src.confidence;
    if (confidence == null && top && typeof top.confidence === 'number') {
      confidence = top.confidence;
    }
    if (confidence == null && typeof extras.confidence === 'number') {
      confidence = extras.confidence;
    }
    if (typeof confidence === 'number') {
      if (confidence < 0) confidence = 0;
      if (confidence > 1) confidence = 1;
    } else {
      confidence = null;
    }

    var msgList = src.messages;
    if (!Array.isArray(msgList)) {
      if (typeof src.message === 'string' && src.message) {
        msgList = [src.message];
      } else if (top && top.message) {
        msgList = [top.message];
      } else if (Array.isArray(messages)) {
        msgList = messages;
      } else {
        msgList = [];
      }
    }

    var evidencePath = src.evidence_path || src.evidencePath || extras.evidence_path || null;
    if (!evidencePath && Array.isArray(src.evidence) && src.evidence[0]) {
      evidencePath = src.evidence[0].path || src.evidence[0].evidence_path || null;
    }

    if (!status || status === 'ok') return null;

    var body = {
      status: status,
      messages: msgList
    };
    if (flagId) body.flag_id = String(flagId);
    if (severity && severity !== 'ok') body.severity = String(severity);
    if (typeof confidence === 'number') body.confidence = confidence;
    if (evidencePath) body.evidence_path = String(evidencePath);
    return body;
  }

  /**
   * POST /api/sessions/{id}/events with the new event shape.
   * @param {object|string} eventOrStatus — full event object or legacy status string
   * @param {string[]|object} [messagesOrExtras]
   * @param {object} [extras]
   */
  function recordEvent(eventOrStatus, messagesOrExtras, extras) {
    if (!sessionId || !backendOnline) return Promise.resolve(null);
    var body = normalizeEvent(eventOrStatus, messagesOrExtras, extras);
    if (!body) return Promise.resolve(null);
    return request('/api/sessions/' + sessionId + '/events', {
      method: 'POST',
      body: body
    }).catch(function (err) {
      console.warn('Event save failed:', err.message);
      return null;
    });
  }

  function submitReport(report) {
    var cal = normalizeCalibration(
      report && report.calibration != null ? report.calibration : pendingCalibration
    );
    if (!backendOnline) {
      return Promise.resolve(null);
    }
    if (!sessionId) {
      // Last-chance: create session with calibration then submit
      return createSession(null, cal).then(function () {
        return submitReport(Object.assign({}, report, { calibration: cal }));
      }).catch(function (err) {
        console.warn('Submit failed (offline):', err && err.message);
        markOffline();
        return null;
      });
    }
    var payload = {
      integrity_score: report.integrityScore,
      suspicious_count: report.suspiciousCount,
      warning_count: report.warningCount,
      duration_seconds: report.durationSeconds || 0,
      events: report.events || [],
      calibration: cal,
      viewport: report.viewport || null,
      evidence: report.evidence || []
    };
    return request('/api/sessions/' + sessionId + '/submit', {
      method: 'POST',
      body: payload
    }).catch(function (err) {
      console.warn('Submit failed:', err.message);
      return null;
    });
  }

  function getSessionId() { return sessionId; }
  function isOnline() { return backendOnline; }
  function resetSession() {
    sessionId = null;
    pendingCalibration = null;
  }

  global.SideNoteAPI = {
    checkHealth: checkHealth,
    startHealthMonitor: startHealthMonitor,
    stopHealthMonitor: stopHealthMonitor,
    createSession: createSession,
    ensureSession: ensureSession,
    saveCalibration: saveCalibration,
    normalizeCalibration: normalizeCalibration,
    recordEvent: recordEvent,
    normalizeEvent: normalizeEvent,
    submitReport: submitReport,
    getSessionId: getSessionId,
    isOnline: isOnline,
    resetSession: resetSession
  };
})(window);
