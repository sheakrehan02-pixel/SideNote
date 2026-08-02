/**
 * Side Note — Backend API client (FastAPI).
 */
(function (global) {
  'use strict';

  var sessionId = null;
  var pendingCalibration = null;
  var backendOnline = false;
  var healthTimer = null;

  function baseUrl() {
    if (global.SIDE_NOTE_API_URL) return global.SIDE_NOTE_API_URL.replace(/\/$/, '');
    return '';
  }

  function markOnline() {
    backendOnline = true;
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
          throw err;
        });
      }
      markOnline();
      if (res.status === 204) return null;
      return res.json();
    });
  }

  function checkHealth() {
    return request('/api/health')
      .then(function (data) {
        backendOnline = !!(data && data.status === 'ok');
        return backendOnline;
      })
      .catch(function () {
        backendOnline = false;
        return false;
      });
  }

  function startHealthMonitor(onChange) {
    if (healthTimer) return;
    function poll() {
      checkHealth().then(function (online) {
        if (typeof onChange === 'function') onChange(online);
      });
    }
    poll();
    healthTimer = global.setInterval(poll, 5000);
  }

  function stopHealthMonitor() {
    if (healthTimer) {
      global.clearInterval(healthTimer);
      healthTimer = null;
    }
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
    return createSession(name, cal);
  }

  function recordEvent(status, messages) {
    if (!sessionId || status === 'ok') return Promise.resolve(null);
    return request('/api/sessions/' + sessionId + '/events', {
      method: 'POST',
      body: { status: status, messages: messages || [] }
    }).catch(function (err) {
      console.warn('Event save failed:', err.message);
      return null;
    });
  }

  function submitReport(report) {
    var cal = normalizeCalibration(
      report && report.calibration != null ? report.calibration : pendingCalibration
    );
    if (!sessionId) {
      // Last-chance: create session with calibration then submit
      return createSession(null, cal).then(function () {
        return submitReport(Object.assign({}, report, { calibration: cal }));
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
    submitReport: submitReport,
    getSessionId: getSessionId,
    isOnline: isOnline,
    resetSession: resetSession
  };
})(window);
