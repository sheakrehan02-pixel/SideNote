/**
 * Side Note — Demo app: setup wizard, calibration, exam, report.
 */
(function () {
  'use strict';

  var STEPS = ['welcome', 'checklist', 'calibrate', 'validate', 'exam', 'report'];
  var currentStep = 0;
  var detector = null;
  var examStartTime = null;
  var lastStatus = 'ok';
  var showGazeDot = true;
  var lastCalibration = null;
  var serverSessionId = null;
  var faceMissStreak = 0;

  var els = {};

  function $(id) { return document.getElementById(id); }

  function bindElements() {
    els.wizard = $('wizard');
    els.gazeDot = $('gazeDot');
    els.calOverlay = $('calOverlay');
    els.statusBadge = $('statusBadge');
    els.statusMessages = $('statusMessages');
    els.examTimer = $('examTimer');
    els.integrityScore = $('integrityScore');
    els.eventLog = $('eventLog');
    els.reportSummary = $('reportSummary');
    els.reportEvents = $('reportEvents');
    els.stepIndicators = document.querySelectorAll('[data-step-indicator]');
    els.panels = document.querySelectorAll('[data-step-panel]');
  }

  function showStep(index) {
    currentStep = index;
    els.panels.forEach(function (panel, i) {
      panel.hidden = i !== index;
    });
    els.stepIndicators.forEach(function (dot, i) {
      dot.classList.toggle('done', i < index);
      dot.classList.toggle('active', i === index);
    });
    if (STEPS[index] === 'exam') startExam();
    if (STEPS[index] === 'report') renderReport();
  }

  function nextStep() { if (currentStep < STEPS.length - 1) showStep(currentStep + 1); }
  function prevStep() { if (currentStep > 0) showStep(currentStep - 1); }

  function setProctorStatus(result) {
    if (!els.statusBadge) return;
    els.statusBadge.textContent = result.status.toUpperCase();
    els.statusBadge.style.background = result.color;
    els.statusMessages.innerHTML = result.messages.length
      ? result.messages.map(function (m) { return '<li>' + m + '</li>'; }).join('')
      : '<li class="ok-msg">Looking good — eyes on the exam</li>';

    if (result.status !== lastStatus) {
      if (detector) detector.logEvent(result.status, result.messages);
      appendLiveLog(result);
      if (typeof SideNoteAPI !== 'undefined') {
        SideNoteAPI.recordEvent(result.status, result.messages);
      }
      lastStatus = result.status;
    }
  }

  function appendLiveLog(result) {
    if (!els.eventLog || result.status === 'ok') return;
    var li = document.createElement('li');
    li.className = result.status;
    li.textContent = new Date().toLocaleTimeString() + ' — ' + (result.messages[0] || result.status);
    els.eventLog.prepend(li);
  }

  function onGaze(sample) {
    if (!sample || currentStep !== STEPS.indexOf('exam')) return;

    faceMissStreak = 0;

    if (showGazeDot && els.gazeDot) {
      els.gazeDot.style.display = 'block';
      els.gazeDot.style.left = sample.x + 'px';
      els.gazeDot.style.top = sample.y + 'px';
    }

    var result = detector.update(sample, true);
    setProctorStatus(result);
  }

  function tickExamMonitor() {
    if (currentStep !== STEPS.indexOf('exam') || !detector) return;
    if (typeof SideNoteGaze === 'undefined') return;

    if (SideNoteGaze.isFaceVisible(900)) {
      faceMissStreak = 0;
      return;
    }

    faceMissStreak += 1;
    if (faceMissStreak > 15) {
      setProctorStatus(detector.update(null, false));
    }
  }

  function startCameraAndGoToCalibration() {
    var btn = $('btnStartCamera');
    btn.disabled = true;
    btn.textContent = 'Starting camera…';

    if (window.saveDataAcrossSessions !== undefined) window.saveDataAcrossSessions = false;

    SideNoteGaze.clearTrainingData();
    SideNoteGaze.start(function () {})
      .then(function () {
        SideNoteGaze.styleWebGazerPreview();
        btn.textContent = 'Camera ready';
        nextStep();
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = 'Allow camera & continue';
        alert(err.message || String(err));
      });
  }

  function runCalibrationFlow() {
    var btn = $('btnRunCalibration');
    var progress = $('calProgress');
    btn.disabled = true;
    progress.textContent = 'Starting…';

    SideNoteGaze.runCalibration(els.calOverlay, function (done, total, samples, needed) {
      if (samples != null) {
        progress.textContent = 'Point ' + done + '/' + total + ' — samples ' + samples + '/' + needed;
      } else {
        progress.textContent = done + ' / ' + total + ' points completed';
      }
    }).then(function (result) {
      btn.disabled = false;
      if (result.cancelled) {
        progress.textContent = 'Calibration cancelled — try again.';
        return;
      }
      if (result.pointsCompleted < 9) {
        progress.textContent = 'Only ' + result.pointsCompleted + '/9 points — try again.';
        return;
      }
      var sampleNote = result.totalSamples
        ? ' (' + result.totalSamples + ' training samples collected)'
        : '';
      progress.textContent = 'All 9 points done' + sampleNote + '. Continue to the accuracy check or start the exam.';
      $('btnAfterCal').disabled = false;
      $('btnStartExam').disabled = false;
    });
  }

  function runValidationFlow() {
    var btn = $('btnRunValidation');
    var out = $('validationResult');
    var continueBtn = $('btnContinueAnyway');
    btn.disabled = true;
    if (continueBtn) continueBtn.disabled = true;
    $('btnStartExam').disabled = true;
    out.textContent = 'Warming up tracker (4 sec)… keep facing the camera.';

    SideNoteGaze.warmupAfterCalibration(4000).then(function () {
      out.textContent = 'Testing accuracy… look at each green dot.';
      return SideNoteGaze.runValidation(els.calOverlay);
    }).then(function (result) {
      btn.disabled = false;
      lastCalibration = {
        points_completed: 9,
        cancelled: false,
        avg_error_px: result.avgErrorPx,
        pass_threshold_px: result.passThresholdPx,
        passed: result.passed,
        training_samples: SideNoteGaze.getTrainingPointCount ? SideNoteGaze.getTrainingPointCount() : null
      };
      if (typeof SideNoteAPI !== 'undefined' && SideNoteAPI.isOnline()) {
        SideNoteAPI.saveCalibration(lastCalibration);
      }

      var msg = '';
      if (result.noTracking) {
        msg = 'Tracker could not read your gaze during the check. You can still start the exam if calibration felt OK — or recalibrate with better lighting.';
        out.className = 'validation-result fail';
        $('btnStartExam').disabled = false;
        $('btnRecalibrate').disabled = false;
        if (continueBtn) continueBtn.disabled = false;
      } else if (result.avgErrorPx == null) {
        msg = 'Not enough samples — but you can start the exam if the orange dot moved near the green dots during the check.';
        $('btnStartExam').disabled = false;
        out.className = 'validation-result fail';
        if (continueBtn) continueBtn.disabled = false;
      } else {
        msg = 'Average error: ' + Math.round(result.avgErrorPx) + ' px (target under ' + Math.round(result.passThresholdPx) + ' px). ';
        msg += result.pointsUnderThreshold + '/' + result.pointsMeasured + ' points on target. ';
        if (result.passed) {
          msg += 'Looks good — start the exam.';
          $('btnStartExam').disabled = false;
          out.className = 'validation-result pass';
        } else {
          msg += 'Tracking is rough but usable — start the exam or recalibrate.';
          out.className = 'validation-result fail';
          $('btnStartExam').disabled = false;
          $('btnRecalibrate').disabled = false;
          if (continueBtn) continueBtn.disabled = false;
        }
      }
      out.textContent = msg;
    }).catch(function (err) {
      btn.disabled = false;
      out.textContent = 'Validation error: ' + (err.message || err);
      out.className = 'validation-result fail';
      if (continueBtn) continueBtn.disabled = false;
    });
  }

  function startExam() {
    detector = new SideNoteCheatingDetector();
    lastStatus = 'ok';
    examStartTime = Date.now();
    faceMissStreak = 0;
    serverSessionId = null;
    if (els.eventLog) els.eventLog.innerHTML = '';
    setProctorStatus({ status: 'ok', messages: [], color: '#7a9e6a' });

    if (typeof SideNoteAPI !== 'undefined') {
      SideNoteAPI.createSession(null).then(function (session) {
        serverSessionId = session.id;
      }).catch(function () {});
    }

    SideNoteGaze.resetSmoothing();
    SideNoteGaze.start(onGaze).then(function () {
      SideNoteGaze.styleWebGazerPreview();
    });

    if (window._examTimerInterval) clearInterval(window._examTimerInterval);
    window._examTimerInterval = setInterval(function () {
      if (!examStartTime || !els.examTimer) return;
      var sec = Math.floor((Date.now() - examStartTime) / 1000);
      var m = Math.floor(sec / 60);
      var s = sec % 60;
      els.examTimer.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }, 1000);

    if (window._faceCheckInterval) clearInterval(window._faceCheckInterval);
    window._faceCheckInterval = setInterval(tickExamMonitor, 250);
  }

  function finishExam() {
    if (window._examTimerInterval) clearInterval(window._examTimerInterval);
    if (window._faceCheckInterval) clearInterval(window._faceCheckInterval);
    SideNoteGaze.stop();
    if (els.gazeDot) els.gazeDot.style.display = 'none';

    if (detector && typeof SideNoteAPI !== 'undefined' && SideNoteAPI.isOnline()) {
      var report = detector.getReport();
      report.durationSeconds = examStartTime
        ? Math.floor((Date.now() - examStartTime) / 1000)
        : 0;
      report.calibration = lastCalibration;
      report.viewport = { width: window.innerWidth, height: window.innerHeight };
      SideNoteAPI.submitReport(report).then(function (saved) {
        if (saved && saved.id) serverSessionId = saved.id;
        nextStep();
      }).catch(function () { nextStep(); });
    } else {
      nextStep();
    }
  }

  function renderReport() {
    var report = detector ? detector.getReport() : { integrityScore: 100, suspiciousCount: 0, warningCount: 0, events: [] };
    if (els.integrityScore) els.integrityScore.textContent = report.integrityScore;
    var sessionLine = '';
    if (serverSessionId) {
      sessionLine = '<p><strong>Session ID:</strong> <code>' + serverSessionId + '</code></p>';
    } else if (typeof SideNoteAPI !== 'undefined' && SideNoteAPI.getSessionId()) {
      sessionLine = '<p><strong>Session ID:</strong> <code>' + SideNoteAPI.getSessionId() + '</code></p>';
    }
    if (els.reportSummary) {
      els.reportSummary.innerHTML =
        sessionLine +
        '<p><strong>Integrity score:</strong> ' + report.integrityScore + '/100</p>' +
        '<p><strong>Warnings:</strong> ' + report.warningCount + ' · <strong>Flags:</strong> ' + report.suspiciousCount + '</p>' +
        (typeof SideNoteAPI !== 'undefined' && SideNoteAPI.isOnline()
          ? '<p class="ok-msg" style="color:var(--ok)">Report saved — you\'re all set.</p>'
          : '<p style="color:var(--muted)">Session saved locally — download the JSON to keep a copy.</p>');
    }
    if (els.reportEvents) {
      els.reportEvents.innerHTML = report.events.length
        ? report.events.map(function (e) {
            return '<li class="' + e.status + '">' + e.time + ' — ' + e.messages.join('; ') + '</li>';
          }).join('')
        : '<li class="ok-msg">No incidents recorded — great job.</li>';
    }
  }

  function downloadReport() {
    if (!detector) return;
    var blob = new Blob([JSON.stringify(detector.getReport(), null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'side-note-session-' + Date.now() + '.json';
    a.click();
  }

  function wireEvents() {
    $('btnStartCamera').addEventListener('click', startCameraAndGoToCalibration);
    $('btnReadyChecklist').addEventListener('click', nextStep);
    $('btnBackChecklist').addEventListener('click', prevStep);
    $('btnRunCalibration').addEventListener('click', runCalibrationFlow);
    $('btnAfterCal').addEventListener('click', nextStep);
    $('btnRunValidation').addEventListener('click', runValidationFlow);
    $('btnRecalibrate').addEventListener('click', function () {
      $('btnStartExam').disabled = true;
      $('btnRecalibrate').disabled = true;
      if ($('btnContinueAnyway')) $('btnContinueAnyway').disabled = true;
      $('validationResult').textContent = '';
      $('validationResult').className = 'validation-result';
      showStep(STEPS.indexOf('calibrate'));
    });
    $('btnStartExam').addEventListener('click', nextStep);
    if ($('btnContinueAnyway')) {
      $('btnContinueAnyway').addEventListener('click', function () {
        $('btnStartExam').disabled = false;
        nextStep();
      });
    }
    $('btnFinishExam').addEventListener('click', finishExam);
    $('btnDownloadReport').addEventListener('click', downloadReport);
    $('btnRestart').addEventListener('click', function () {
      SideNoteGaze.stop();
      if (typeof SideNoteAPI !== 'undefined') SideNoteAPI.resetSession();
      detector = null;
      serverSessionId = null;
      lastCalibration = null;
      $('btnAfterCal').disabled = true;
      $('btnStartExam').disabled = true;
      $('btnRecalibrate').disabled = true;
      if ($('btnContinueAnyway')) $('btnContinueAnyway').disabled = true;
      $('calProgress').textContent = '';
      $('validationResult').textContent = '';
      showStep(0);
    });
    $('toggleGazeDot').addEventListener('change', function (e) {
      showGazeDot = e.target.checked;
      if (!showGazeDot && els.gazeDot) els.gazeDot.style.display = 'none';
    });
  }

  function initLibraryStatus() {
    var el = $('libraryStatus');
    var apiEl = $('apiStatus');

    function showWebGazer(src) {
      el.textContent = 'Camera tracking is ready (' + src + '). Chrome or Edge works best.';
      el.className = 'lib-status ok';
    }

    function showBackendStatus(online) {
      if (!apiEl) return;
      if (online) {
        apiEl.textContent = 'Connected — your session will be saved automatically.';
        apiEl.className = 'lib-status ok';
      } else {
        apiEl.textContent = 'Not connected yet — start the server with: python run_server.py';
        apiEl.className = 'lib-status warn';
      }
    }

    SideNoteGaze.waitForWebGazer().then(function () {
      showWebGazer(window._webgazerSource || 'loaded');
    }).catch(function (err) {
      el.textContent = err.message;
      el.className = 'lib-status err';
    });

    if (typeof SideNoteAPI !== 'undefined' && apiEl) {
      SideNoteAPI.startHealthMonitor(showBackendStatus);
    }
  }

  function init() {
    bindElements();
    wireEvents();
    initLibraryStatus();
    showStep(0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
