/**
 * Side Note — Backend API client (FastAPI).
 */
(function (global) {
  'use strict';

  var sessionId = null;
  var backendOnline = false;

  function baseUrl() {
    if (global.SIDE_NOTE_API_URL) return global.SIDE_NOTE_API_URL.replace(/\/$/, '');
    return '';
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

  function createSession(studentName) {
    return request('/api/sessions', {
      method: 'POST',
      body: {
        student_name: studentName || null,
        exam_id: 'practice-biology'
      }
    }).then(function (data) {
      sessionId = data.id;
      return data;
    });
  }

  function saveCalibration(calibration) {
    if (!sessionId || !backendOnline) return Promise.resolve(null);
    return request('/api/sessions/' + sessionId + '/calibration', {
      method: 'POST',
      body: calibration
    }).catch(function (err) {
      console.warn('Calibration save failed:', err.message);
      return null;
    });
  }

  function recordEvent(status, messages) {
    if (!sessionId || !backendOnline || status === 'ok') return Promise.resolve(null);
    return request('/api/sessions/' + sessionId + '/events', {
      method: 'POST',
      body: { status: status, messages: messages || [] }
    }).catch(function (err) {
      console.warn('Event save failed:', err.message);
      return null;
    });
  }

  function submitReport(report) {
    if (!sessionId || !backendOnline) return Promise.resolve(null);
    var payload = {
      integrity_score: report.integrityScore,
      suspicious_count: report.suspiciousCount,
      warning_count: report.warningCount,
      duration_seconds: report.durationSeconds || 0,
      events: report.events || [],
      calibration: report.calibration || null,
      viewport: report.viewport || null
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
  function resetSession() { sessionId = null; }

  global.SideNoteAPI = {
    checkHealth: checkHealth,
    createSession: createSession,
    saveCalibration: saveCalibration,
    recordEvent: recordEvent,
    submitReport: submitReport,
    getSessionId: getSessionId,
    isOnline: isOnline,
    resetSession: resetSession
  };
})(window);
