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
  var lastFlagKey = 'ok';
  var showGazeDot = true;
  var lastCalibration = null;
  var serverSessionId = null;
  var faceMissStreak = 0;
  var studentIdentity = '';
  var environmentConfirmedAt = null;

  var els = {};

  /** Instructor-facing labels from docs/FLAG_TAXONOMY.md */
  var FLAG_LABELS = {
    looking_down: 'Looking down (desk / lap)',
    gaze_off_screen: 'Gaze off-screen (side)',
    face_not_visible: 'Face not visible',
    hands_in_lap: 'Hands low / in lap zone',
    phone_risk: 'Possible phone / notes in lap'
  };

  var ENV_CHECK_IDS = ['envLighting', 'envDistance', 'envFullscreen'];

  function $(id) { return document.getElementById(id); }

  function bindElements() {
    els.wizard = $('wizard');
    els.gazeDot = $('gazeDot');
    els.calOverlay = $('calOverlay');
    els.statusBadge = $('statusBadge');
    els.activeFlagsEmpty = $('activeFlagsEmpty');
    els.activeFlagsList = $('activeFlagsList');
    els.statusDetail = $('statusDetail');
    els.examTimer = $('examTimer');
    els.integrityScore = $('integrityScore');
    els.eventLog = $('eventLog');
    els.reportSummary = $('reportSummary');
    els.reportEvents = $('reportEvents');
    els.reportEvidence = $('reportEvidence');
    els.studentIdentity = $('studentIdentity');
    els.studentIdentityHint = $('studentIdentityHint');
    els.envLighting = $('envLighting');
    els.envDistance = $('envDistance');
    els.envFullscreen = $('envFullscreen');
    els.envChecklistHint = $('envChecklistHint');
    els.envFullscreenStatus = $('envFullscreenStatus');
    els.btnReadyChecklist = $('btnReadyChecklist');
    els.btnEnterFullscreen = $('btnEnterFullscreen');
    els.stepIndicators = document.querySelectorAll('[data-step-indicator]');
    els.panels = document.querySelectorAll('[data-step-panel]');
  }

  function flagInstructorLabel(id) {
    return FLAG_LABELS[id] || id;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderActiveFlags(flags) {
    if (!els.activeFlagsList || !els.activeFlagsEmpty) return;

    if (!flags || !flags.length) {
      els.activeFlagsEmpty.hidden = false;
      els.activeFlagsList.hidden = true;
      els.activeFlagsList.innerHTML = '';
      if (els.statusDetail) els.statusDetail.textContent = '';
      return;
    }

    els.activeFlagsEmpty.hidden = true;
    els.activeFlagsList.hidden = false;
    els.activeFlagsList.innerHTML = flags.map(function (f) {
      var conf = typeof f.confidence === 'number' ? Math.round(f.confidence * 100) + '%' : '—';
      return (
        '<li class="flag-row ' + escapeHtml(f.severity) + '">' +
          '<span class="flag-label">' + escapeHtml(flagInstructorLabel(f.id)) + '</span>' +
          '<span class="flag-severity ' + escapeHtml(f.severity) + '">' + escapeHtml(f.severity) + '</span>' +
          '<span class="flag-id">' + escapeHtml(f.id) + ' · confidence ' + conf + '</span>' +
          '<span class="flag-meta">' + escapeHtml(f.message || '') + '</span>' +
        '</li>'
      );
    }).join('');

    if (els.statusDetail) {
      var top = flags[0];
      els.statusDetail.textContent = top
        ? ('Top signal: ' + flagInstructorLabel(top.id))
        : '';
    }
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
    if (STEPS[index] === 'exam') {
      if (!calibrationPassed() || !hasStudentIdentity()) {
        showStep(STEPS.indexOf('validate'));
        var out = $('validationResult');
        if (!calibrationPassed() && out && !out.textContent) {
          out.textContent = 'Accuracy check required (≤ ' + Math.round(accuracyThresholdPx()) +
            ' px) before starting the exam.';
          out.className = 'validation-result fail';
        }
        validateStudentIdentity(true);
        refreshExamStartGate();
        return;
      }
      startExam();
    }
    if (STEPS[index] === 'calibrate') {
      if (!environmentConfirmed()) {
        showStep(STEPS.indexOf('checklist'));
        validateEnvironmentChecklist(true);
        return;
      }
    }
    if (STEPS[index] === 'report') renderReport();
  }

  function nextStep() { if (currentStep < STEPS.length - 1) showStep(currentStep + 1); }
  function prevStep() { if (currentStep > 0) showStep(currentStep - 1); }

  function setProctorStatus(result) {
    if (!els.statusBadge) return;

    result = result || { status: 'ok', messages: [], color: '#7a9e6a', flags: [] };
    var status = result.status || 'ok';
    var flags = result.flags || [];
    var messages = result.messages && result.messages.length
      ? result.messages
      : flags.map(function (f) { return f.message; }).filter(Boolean);
    var color = result.color || '#7a9e6a';
    var topFlag = flags[0] || null;
    var flagKey = topFlag ? (topFlag.id + ':' + topFlag.severity) : status;

    els.statusBadge.textContent = topFlag
      ? (status.toUpperCase() + ' · ' + topFlag.id)
      : status.toUpperCase();
    els.statusBadge.style.background = color;
    renderActiveFlags(flags);

    if (status !== lastStatus || flagKey !== lastFlagKey) {
      if (detector && status !== 'ok') {
        detector.logEvent(status, messages, flags);
      }
      appendLiveLog({ status: status, messages: messages, flags: flags });
      if (typeof SideNoteAPI !== 'undefined' && status !== 'ok') {
        SideNoteAPI.recordEvent(status, messages);
      }
      if (flags.length && typeof console !== 'undefined' && console.log) {
        console.log('[SideNote flags]', flags.map(function (f) {
          return {
            id: f.id,
            severity: f.severity,
            confidence: f.confidence,
            startedAt: f.startedAt,
            message: f.message,
            meta: f.meta || null
          };
        }));
      }
      // Suspicious + phone_risk → 2–3s JPEG burst from webcam
      if (typeof SideNoteEvidence !== 'undefined' && SideNoteEvidence.needsCapture(status, flags)) {
        SideNoteEvidence.captureForFlags(status, flags).then(function (entries) {
          if (entries && entries.length && typeof console !== 'undefined' && console.log) {
            console.log('[SideNote evidence]', entries.map(function (e) {
              return { flag: e.flag, t: e.t, bytes: e.imageDataUrl ? e.imageDataUrl.length : 0 };
            }));
          }
        });
      }
      lastStatus = status;
      lastFlagKey = flagKey;
    }
  }

  function appendLiveLog(result) {
    if (!els.eventLog || result.status === 'ok') return;
    var top = (result.flags && result.flags[0]) || null;
    var li = document.createElement('li');
    li.className = result.status;
    if (top) {
      li.innerHTML =
        new Date().toLocaleTimeString() +
        ' — <span class="log-flag-id">' + escapeHtml(top.id) + '</span> · ' +
        escapeHtml(flagInstructorLabel(top.id));
    } else {
      li.textContent = new Date().toLocaleTimeString() + ' — ' + (result.messages[0] || result.status);
    }
    els.eventLog.prepend(li);
  }

  /**
   * Face presence: prefer MediaPipe Face Mesh; fall back to WebGazer.
   * Screen gaze always comes from WebGazer samples in onGaze.
   */
  function readFaceVisible(maxAgeMs) {
    maxAgeMs = maxAgeMs || 900;
    if (typeof SideNoteFace !== 'undefined' && SideNoteFace.isReady()) {
      return SideNoteFace.isFaceVisible(maxAgeMs);
    }
    if (typeof SideNoteGaze !== 'undefined') {
      return SideNoteGaze.isFaceVisible(maxAgeMs);
    }
    return true;
  }

  function readHeadPose() {
    if (typeof SideNoteFace === 'undefined' || !SideNoteFace.isReady()) return null;
    return SideNoteFace.getHeadPose();
  }

  function readFacesCount() {
    if (typeof SideNoteFace === 'undefined' || !SideNoteFace.isReady()) return null;
    return SideNoteFace.getFacesCount();
  }

  /** MediaPipe Hands → { inLap, count } for phone_risk co-occurrence */
  function readHands() {
    if (typeof SideNoteHands === 'undefined' || !SideNoteHands.isReady()) return null;
    return SideNoteHands.getHands();
  }

  function buildDetectorInput(gazeSample, faceVisible) {
    return {
      gaze: faceVisible ? gazeSample : null,
      faceVisible: !!faceVisible,
      hands: faceVisible ? readHands() : null,
      headPose: readHeadPose(),
      facesCount: readFacesCount()
    };
  }

  function startFaceEngine() {
    if (typeof SideNoteFace === 'undefined') return Promise.resolve(false);
    return SideNoteFace.start().then(function () {
      if (typeof console !== 'undefined' && console.log) {
        console.log('[SideNote] Face Mesh running (presence/pose); WebGazer keeps screen gaze.');
      }
      return true;
    }).catch(function (err) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[SideNote] Face Mesh unavailable — using WebGazer face check', err);
      }
      return false;
    });
  }

  function startHandEngine() {
    if (typeof SideNoteHands === 'undefined') return Promise.resolve(false);
    return SideNoteHands.start().then(function () {
      if (typeof console !== 'undefined' && console.log) {
        console.log('[SideNote] Hands running — looking_down + inLap → phone_risk.');
      }
      return true;
    }).catch(function (err) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[SideNote] Hands unavailable — phone_risk disabled', err);
      }
      return false;
    });
  }

  function startVisionEngines() {
    return startFaceEngine().then(function () {
      return startHandEngine();
    });
  }

  function stopFaceEngine() {
    if (typeof SideNoteFace !== 'undefined') SideNoteFace.stop();
  }

  function stopHandEngine() {
    if (typeof SideNoteHands !== 'undefined') SideNoteHands.stop();
  }

  function stopVisionEngines() {
    stopFaceEngine();
    stopHandEngine();
  }

  function onGaze(sample) {
    if (!sample || currentStep !== STEPS.indexOf('exam')) return;

    var faceVisible = readFaceVisible(900);
    if (faceVisible) faceMissStreak = 0;

    if (showGazeDot && els.gazeDot && faceVisible) {
      els.gazeDot.style.display = 'block';
      els.gazeDot.style.left = sample.x + 'px';
      els.gazeDot.style.top = sample.y + 'px';
    } else if (els.gazeDot && !faceVisible) {
      els.gazeDot.style.display = 'none';
    }

    // WebGazer → gaze; Face Mesh → presence/pose; Hands → inLap → phone_risk
    var result = detector.update(buildDetectorInput(sample, faceVisible));
    setProctorStatus(result);
  }

  function tickExamMonitor() {
    if (currentStep !== STEPS.indexOf('exam') || !detector) return;

    if (readFaceVisible(900)) {
      faceMissStreak = 0;
      return;
    }

    faceMissStreak += 1;
    if (faceMissStreak > 15) {
      setProctorStatus(detector.update(buildDetectorInput(null, false)));
    }
  }

  function startCameraAndGoToCalibration() {
    var btn = $('btnStartCamera');
    btn.disabled = true;
    btn.textContent = 'Starting camera…';

    if (window.saveDataAcrossSessions !== undefined) window.saveDataAcrossSessions = false;

    // Clear after tracker is up — clearData before begin() can throw in WebGazer
    SideNoteGaze.start(function () {})
      .then(function () {
        return SideNoteGaze.clearTrainingData();
      })
      .then(function () {
        SideNoteGaze.styleWebGazerPreview();
        // Warm Face Mesh + Hands on the same video during checklist/calibration
        startVisionEngines();
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

    SideNoteGaze.runCalibration(els.calOverlay, function (done, total) {
      progress.textContent = done + ' / ' + total + ' points completed';
    }).then(function (result) {
      btn.disabled = false;
      if (result.cancelled) {
        progress.textContent = 'Calibration cancelled — try again.';
        return;
      }
      if (result.trainingPoints < 9) {
        progress.textContent = 'Only ' + (result.trainingPoints || 0) + ' training samples saved — recalibrate with your face visible and good lighting.';
        return;
      }
      if (result.pointsCompleted < 9) {
        progress.textContent = 'Only ' + result.pointsCompleted + '/9 points — try again.';
        return;
      }
      progress.textContent = 'All 9 points done (' + result.trainingPoints + ' samples). Continue to the accuracy check — exam unlocks only if it passes.';
      $('btnAfterCal').disabled = false;
      setExamStartEnabled(false);
    }).catch(function (err) {
      btn.disabled = false;
      progress.textContent = err.message || String(err);
    });
  }

  function accuracyThresholdPx() {
    if (typeof SideNoteGaze !== 'undefined' && SideNoteGaze.getPassThresholdPx) {
      return SideNoteGaze.getPassThresholdPx();
    }
    var configured = window.SIDE_NOTE_ACCURACY_THRESHOLD_PX;
    return typeof configured === 'number' && configured > 0 ? configured : 180;
  }

  function setExamStartEnabled(enabled) {
    var btn = $('btnStartExam');
    if (!btn) return;
    // Both accuracy pass AND identity are required
    btn.disabled = !(enabled && hasStudentIdentity());
  }

  function hasStudentIdentity() {
    var raw = els.studentIdentity
      ? els.studentIdentity.value
      : studentIdentity;
    return !!(raw && String(raw).trim().length >= 2);
  }

  function readStudentIdentity() {
    var raw = els.studentIdentity ? els.studentIdentity.value : studentIdentity;
    studentIdentity = raw ? String(raw).trim() : '';
    return studentIdentity;
  }

  function isLikelyEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function validateStudentIdentity(showError) {
    var value = readStudentIdentity();
    var input = els.studentIdentity;
    var hint = els.studentIdentityHint;
    var ok = value.length >= 2;

    if (input) input.classList.toggle('invalid', showError && !ok);
    if (hint) {
      if (showError && !ok) {
        hint.textContent = 'Enter your name or email before starting the exam.';
        hint.className = 'identity-hint error';
      } else if (ok && isLikelyEmail(value)) {
        hint.textContent = 'Email saved with your session.';
        hint.className = 'identity-hint';
      } else if (ok) {
        hint.textContent = 'Name saved with your session.';
        hint.className = 'identity-hint';
      } else {
        hint.textContent = 'Required before starting the exam. Saved with your session report.';
        hint.className = 'identity-hint';
      }
    }
    return ok;
  }

  function refreshExamStartGate() {
    setExamStartEnabled(calibrationPassed());
  }

  function isFullscreenActive() {
    return !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.msFullscreenElement
    );
  }

  function readEnvironmentChecklist() {
    return {
      lighting: !!(els.envLighting && els.envLighting.checked),
      distance: !!(els.envDistance && els.envDistance.checked),
      fullscreen: !!(els.envFullscreen && els.envFullscreen.checked),
      fullscreenActive: isFullscreenActive(),
      confirmedAt: environmentConfirmedAt
    };
  }

  function environmentConfirmed() {
    var env = readEnvironmentChecklist();
    return !!(env.lighting && env.distance && env.fullscreen);
  }

  function setEnvCheckInvalid(showError) {
    ENV_CHECK_IDS.forEach(function (id) {
      var input = $(id);
      if (!input) return;
      var shell = input.closest('.env-check-label') || input.closest('.env-check');
      if (!shell) return;
      var missing = showError && !input.checked;
      shell.classList.toggle('invalid', missing);
    });
  }

  function updateFullscreenStatus() {
    var status = els.envFullscreenStatus;
    if (!status) return;
    if (isFullscreenActive()) {
      status.textContent = 'Fullscreen active';
      status.className = 'env-fs-status ok';
      if (els.envFullscreen && !els.envFullscreen.checked) {
        els.envFullscreen.checked = true;
      }
    } else if (els.envFullscreen && els.envFullscreen.checked) {
      status.textContent = 'Confirmed maximized — fullscreen API not active (OK if you maximized the window)';
      status.className = 'env-fs-status warn';
    } else {
      status.textContent = 'Not in fullscreen yet — click Enter fullscreen or maximize this window, then check the box';
      status.className = 'env-fs-status';
    }
  }

  function refreshEnvironmentGate() {
    var ready = environmentConfirmed();
    if (ready) {
      environmentConfirmedAt = environmentConfirmedAt || new Date().toISOString();
    } else {
      environmentConfirmedAt = null;
    }
    if (els.btnReadyChecklist) els.btnReadyChecklist.disabled = !ready;
    updateFullscreenStatus();
    if (ready) {
      setEnvCheckInvalid(false);
      if (els.envChecklistHint) {
        els.envChecklistHint.textContent = 'Environment confirmed. You can continue to calibration.';
        els.envChecklistHint.className = 'env-hint';
      }
    } else if (els.envChecklistHint && els.envChecklistHint.className.indexOf('error') === -1) {
      els.envChecklistHint.textContent = 'Check all three items to continue.';
      els.envChecklistHint.className = 'env-hint';
    }
  }

  function validateEnvironmentChecklist(showError) {
    var ok = environmentConfirmed();
    setEnvCheckInvalid(showError && !ok);
    if (els.envChecklistHint) {
      if (showError && !ok) {
        els.envChecklistHint.textContent = 'Confirm lighting, distance, and fullscreen before calibrating.';
        els.envChecklistHint.className = 'env-hint error';
      } else if (ok) {
        els.envChecklistHint.textContent = 'Environment confirmed. You can continue to calibration.';
        els.envChecklistHint.className = 'env-hint';
      } else {
        els.envChecklistHint.textContent = 'Check all three items to continue.';
        els.envChecklistHint.className = 'env-hint';
      }
    }
    refreshEnvironmentGate();
    return ok;
  }

  function resetEnvironmentChecklist() {
    environmentConfirmedAt = null;
    ENV_CHECK_IDS.forEach(function (id) {
      var input = $(id);
      if (input) input.checked = false;
    });
    setEnvCheckInvalid(false);
    if (els.btnReadyChecklist) els.btnReadyChecklist.disabled = true;
    if (els.envChecklistHint) {
      els.envChecklistHint.textContent = 'Check all three items to continue.';
      els.envChecklistHint.className = 'env-hint';
    }
    updateFullscreenStatus();
  }

  function requestAppFullscreen() {
    var root = document.documentElement;
    var req = root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen;
    if (!req) {
      updateFullscreenStatus();
      if (els.envFullscreenStatus) {
        els.envFullscreenStatus.textContent = 'Fullscreen API unavailable — maximize this window, then check the box';
        els.envFullscreenStatus.className = 'env-fs-status warn';
      }
      return Promise.resolve(false);
    }
    return Promise.resolve(req.call(root)).then(function () {
      updateFullscreenStatus();
      refreshEnvironmentGate();
      return true;
    }).catch(function () {
      if (els.envFullscreenStatus) {
        els.envFullscreenStatus.textContent = 'Fullscreen blocked — maximize the window manually, then check the box';
        els.envFullscreenStatus.className = 'env-fs-status warn';
      }
      return false;
    });
  }

  function continueFromChecklist() {
    if (!validateEnvironmentChecklist(true)) return;
    // Best-effort enter fullscreen on continue (user gesture)
    var proceed = function () { nextStep(); };
    if (!isFullscreenActive()) {
      requestAppFullscreen().then(proceed, proceed);
    } else {
      proceed();
    }
  }

  function calibrationPassed() {
    return !!(lastCalibration && lastCalibration.passed === true);
  }

  function buildCalibrationRecord(result) {
    var points = result.pointsMeasured != null ? result.pointsMeasured : 9;
    var raw = {
      avg_error_px: result.avgErrorPx != null ? result.avgErrorPx : null,
      passed: !!result.passed,
      points: points,
      points_completed: 9,
      pass_threshold_px: result.passThresholdPx,
      training_samples: SideNoteGaze.getTrainingPointCount
        ? SideNoteGaze.getTrainingPointCount()
        : null,
      cancelled: false
    };
    if (typeof SideNoteAPI !== 'undefined' && SideNoteAPI.normalizeCalibration) {
      return SideNoteAPI.normalizeCalibration(raw);
    }
    return {
      avg_error_px: raw.avg_error_px,
      passed: raw.passed,
      points: raw.points
    };
  }

  function persistCalibrationToSession(cal) {
    if (typeof SideNoteAPI === 'undefined' || !SideNoteAPI.isOnline()) {
      return Promise.resolve(null);
    }
    return SideNoteAPI.ensureSession(readStudentIdentity() || null, cal).then(function (session) {
      if (session && session.id) serverSessionId = session.id;
      return session;
    }).catch(function (err) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[SideNote] Session/calibration persist failed', err);
      }
      return null;
    });
  }

  function runValidationFlow() {
    var btn = $('btnRunValidation');
    var out = $('validationResult');
    btn.disabled = true;
    setExamStartEnabled(false);
    out.textContent = 'Warming up tracker (4 sec)… keep facing the camera.';

    SideNoteGaze.warmupAfterCalibration(4000).then(function () {
      out.textContent = 'Testing accuracy… look at each green dot (target ≤ ' +
        Math.round(accuracyThresholdPx()) + ' px).';
      return SideNoteGaze.runValidation(els.calOverlay);
    }).then(function (result) {
      btn.disabled = false;
      lastCalibration = buildCalibrationRecord(result);
      // Create session + save calibration now (fixes null sessionId during validation)
      persistCalibrationToSession(lastCalibration);

      var threshold = Math.round(result.passThresholdPx || accuracyThresholdPx());
      var msg = '';
      if (result.noTracking) {
        msg = 'Tracker could not read your gaze. Recalibrate with better lighting — Start exam stays locked until accuracy passes (≤ ' + threshold + ' px).';
        out.className = 'validation-result fail';
        setExamStartEnabled(false);
        $('btnRecalibrate').disabled = false;
      } else if (result.avgErrorPx == null) {
        msg = 'Not enough samples to score accuracy. Recalibrate — Start exam stays locked until you pass (≤ ' + threshold + ' px).';
        setExamStartEnabled(false);
        out.className = 'validation-result fail';
        $('btnRecalibrate').disabled = false;
      } else {
        msg = 'Average error: ' + Math.round(result.avgErrorPx) + ' px (must be ≤ ' + threshold + ' px). ';
        msg += result.pointsUnderThreshold + '/' + result.pointsMeasured + ' points on target. ';
        if (result.passed) {
          msg += 'Passed — you can start the exam.';
          setExamStartEnabled(true);
          out.className = 'validation-result pass';
        } else {
          msg += 'Failed accuracy gate — recalibrate, then run the check again.';
          out.className = 'validation-result fail';
          setExamStartEnabled(false);
          $('btnRecalibrate').disabled = false;
        }
      }
      out.textContent = msg;
    }).catch(function (err) {
      btn.disabled = false;
      out.textContent = 'Validation error: ' + (err.message || err);
      out.className = 'validation-result fail';
      setExamStartEnabled(false);
      if ($('btnRecalibrate')) $('btnRecalibrate').disabled = false;
    });
  }

  function buildFullReport() {
    var report = detector
      ? detector.getReport()
      : { integrityScore: 100, suspiciousCount: 0, warningCount: 0, events: [] };
    report.durationSeconds = examStartTime
      ? Math.floor((Date.now() - examStartTime) / 1000)
      : (report.durationSeconds || 0);
    report.calibration = (typeof SideNoteAPI !== 'undefined' && SideNoteAPI.normalizeCalibration)
      ? SideNoteAPI.normalizeCalibration(lastCalibration)
      : lastCalibration;
    report.viewport = { width: window.innerWidth, height: window.innerHeight };
    report.studentIdentity = readStudentIdentity() || null;
    report.environment = readEnvironmentChecklist();
    report.evidence = typeof SideNoteEvidence !== 'undefined'
      ? SideNoteEvidence.getItems()
      : [];
    return report;
  }

  function startExam() {
    if (!calibrationPassed()) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[SideNote] Blocked exam start — accuracy check not passed.');
      }
      return;
    }
    if (!validateStudentIdentity(true)) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[SideNote] Blocked exam start — student name/email required.');
      }
      refreshExamStartGate();
      return;
    }

    detector = new SideNoteCheatingDetector();
    lastStatus = 'ok';
    lastFlagKey = 'ok';
    examStartTime = Date.now();
    faceMissStreak = 0;
    if (typeof SideNoteEvidence !== 'undefined') SideNoteEvidence.reset();
    if (els.eventLog) els.eventLog.innerHTML = '';
    setProctorStatus({ status: 'ok', messages: [], color: '#7a9e6a', flags: [] });

    if (typeof console !== 'undefined' && console.log) {
      console.log('[SideNote] Exam started — calibration passed (≤ ' +
        Math.round((lastCalibration && lastCalibration.pass_threshold_px) || accuracyThresholdPx()) +
        ' px), student=' + readStudentIdentity());
    }

    if (typeof SideNoteAPI !== 'undefined') {
      SideNoteAPI.ensureSession(readStudentIdentity(), lastCalibration).then(function (session) {
        if (session && session.id) serverSessionId = session.id;
      }).catch(function () {});
    }

    SideNoteGaze.resetSmoothing();
    SideNoteGaze.start(onGaze).then(function () {
      SideNoteGaze.styleWebGazerPreview();
      return startVisionEngines();
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

    var btn = $('btnFinishExam');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Saving…';
    }

    var wait = typeof SideNoteEvidence !== 'undefined' && SideNoteEvidence.whenIdle
      ? SideNoteEvidence.whenIdle(2500)
      : Promise.resolve(true);

    wait.then(function () {
      SideNoteGaze.stop();
      stopVisionEngines();
      if (els.gazeDot) els.gazeDot.style.display = 'none';

      if (detector && typeof SideNoteAPI !== 'undefined' && SideNoteAPI.isOnline()) {
        var report = buildFullReport();
        return SideNoteAPI.submitReport(report).then(function (saved) {
          if (saved && saved.id) serverSessionId = saved.id;
        }).catch(function () { /* still show report */ });
      }
      return null;
    }).then(function () {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Submit exam';
      }
      nextStep();
    });
  }

  function renderEvidence(evidence) {
    if (!els.reportEvidence) return;
    evidence = evidence || [];
    if (!evidence.length) {
      els.reportEvidence.innerHTML =
        '<p class="evidence-empty">No snapshots captured this session. Suspicious and phone_risk events save webcam stills here.</p>';
      return;
    }

    els.reportEvidence.innerHTML = evidence.map(function (item, index) {
      var thumb = item.imageDataUrl || '';
      var when = item.t ? new Date(item.t).toLocaleTimeString() : '';
      var label = flagInstructorLabel(item.flag);
      if (!thumb) {
        return (
          '<article class="evidence-card evidence-card--empty">' +
            '<div class="ev-meta">' +
              '<div class="ev-flag">' + escapeHtml(item.flag || 'unknown') + '</div>' +
              '<div>Frame unavailable</div>' +
            '</div>' +
          '</article>'
        );
      }
      return (
        '<article class="evidence-card" data-evidence-index="' + index + '">' +
          '<button type="button" class="evidence-thumb" data-evidence-open="' + index + '" title="View larger">' +
            '<img src="' + thumb + '" alt="' + escapeHtml(label) + ' at ' + escapeHtml(when) + '">' +
          '</button>' +
          '<div class="ev-meta">' +
            '<div class="ev-flag">' + escapeHtml(item.flag || 'unknown') + '</div>' +
            '<div class="ev-label">' + escapeHtml(label) + '</div>' +
            '<div>' + escapeHtml(when) + '</div>' +
          '</div>' +
        '</article>'
      );
    }).join('');

    // Click thumbnail → simple lightbox
    els.reportEvidence.onclick = function (ev) {
      var openBtn = ev.target.closest('[data-evidence-open]');
      if (!openBtn) return;
      var idx = parseInt(openBtn.getAttribute('data-evidence-open'), 10);
      var item = evidence[idx];
      if (!item || !item.imageDataUrl) return;
      openEvidenceLightbox(item);
    };
  }

  function openEvidenceLightbox(item) {
    var existing = document.getElementById('evidenceLightbox');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'evidenceLightbox';
    overlay.className = 'evidence-lightbox';
    overlay.innerHTML =
      '<div class="evidence-lightbox-inner" role="dialog" aria-modal="true">' +
        '<img src="' + item.imageDataUrl + '" alt="' + escapeHtml(flagInstructorLabel(item.flag)) + '">' +
        '<p><span class="log-flag-id">' + escapeHtml(item.flag || '') + '</span> · ' +
          escapeHtml(flagInstructorLabel(item.flag)) + '<br>' +
          escapeHtml(item.t ? new Date(item.t).toLocaleString() : '') +
        '</p>' +
        '<button type="button" class="btn btn-secondary" id="evidenceLightboxClose">Close</button>' +
      '</div>';
    document.body.appendChild(overlay);

    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
    }
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.id === 'evidenceLightboxClose') close();
    });
    document.addEventListener('keydown', onKey);
  }

  function renderReport() {
    var report = buildFullReport();
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
        '<p><strong>Student:</strong> ' + escapeHtml(readStudentIdentity() || '—') + '</p>' +
        '<p><strong>Environment:</strong> ' +
          (report.environment && report.environment.lighting && report.environment.distance && report.environment.fullscreen
            ? 'Lighting · Distance · Fullscreen confirmed'
            : 'Not fully confirmed') +
        '</p>' +
        '<p><strong>Integrity score:</strong> ' + report.integrityScore + '/100</p>' +
        '<p><strong>Warnings:</strong> ' + report.warningCount + ' · <strong>Flags:</strong> ' + report.suspiciousCount + '</p>' +
        '<p><strong>Evidence snapshots:</strong> ' +
          (report.evidence ? report.evidence.length : 0) +
          ' / ' +
          (typeof SideNoteEvidence !== 'undefined' ? SideNoteEvidence.MAX_ITEMS : 8) +
          ' max</p>' +
        (typeof SideNoteAPI !== 'undefined' && SideNoteAPI.isOnline()
          ? '<p class="ok-msg" style="color:var(--ok)">Report saved — you\'re all set.</p>'
          : '<p style="color:var(--muted)">Session saved locally — download the JSON to keep a copy.</p>');
    }
    renderEvidence(report.evidence);
    if (els.reportEvents) {
      els.reportEvents.innerHTML = report.events.length
        ? report.events.map(function (e) {
            var top = (e.flags && e.flags[0]) || null;
            var detail = top
              ? ('<span class="log-flag-id">' + escapeHtml(top.id) + '</span> [' +
                 escapeHtml(top.severity) + '] — ' +
                 escapeHtml(flagInstructorLabel(top.id)))
              : escapeHtml(e.messages.join('; '));
            return '<li class="' + e.status + '">' + e.time + ' — ' + detail + '</li>';
          }).join('')
        : '<li class="ok-msg">No incidents recorded — great job.</li>';
    }
  }

  function downloadReport() {
    if (!detector) return;
    var blob = new Blob([JSON.stringify(buildFullReport(), null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'side-note-session-' + Date.now() + '.json';
    a.click();
  }

  function wireEvents() {
    $('btnStartCamera').addEventListener('click', startCameraAndGoToCalibration);
    $('btnReadyChecklist').addEventListener('click', continueFromChecklist);
    $('btnBackChecklist').addEventListener('click', prevStep);
    if (els.btnEnterFullscreen) {
      els.btnEnterFullscreen.addEventListener('click', function () {
        requestAppFullscreen().then(function (ok) {
          if (ok && els.envFullscreen) {
            els.envFullscreen.checked = true;
            validateEnvironmentChecklist(false);
          } else {
            updateFullscreenStatus();
          }
        });
      });
    }
    ENV_CHECK_IDS.forEach(function (id) {
      var input = $(id);
      if (!input) return;
      input.addEventListener('change', function () {
        validateEnvironmentChecklist(false);
      });
    });
    document.addEventListener('fullscreenchange', function () {
      updateFullscreenStatus();
      refreshEnvironmentGate();
    });
    document.addEventListener('webkitfullscreenchange', function () {
      updateFullscreenStatus();
      refreshEnvironmentGate();
    });
    $('btnRunCalibration').addEventListener('click', runCalibrationFlow);
    $('btnAfterCal').addEventListener('click', nextStep);
    $('btnRunValidation').addEventListener('click', runValidationFlow);
    $('btnRecalibrate').addEventListener('click', function () {
      setExamStartEnabled(false);
      lastCalibration = null;
      studentIdentity = '';
      if (els.studentIdentity) els.studentIdentity.value = '';
      validateStudentIdentity(false);
      serverSessionId = null;
      if (typeof SideNoteAPI !== 'undefined') SideNoteAPI.resetSession();
      $('btnRecalibrate').disabled = true;
      $('validationResult').textContent = '';
      $('validationResult').className = 'validation-result';
      showStep(STEPS.indexOf('calibrate'));
    });
    $('btnStartExam').addEventListener('click', function () {
      if (!calibrationPassed()) {
        refreshExamStartGate();
        var out = $('validationResult');
        if (out) {
          out.textContent = 'Run the accuracy check and pass (≤ ' +
            Math.round(accuracyThresholdPx()) + ' px) before starting.';
          out.className = 'validation-result fail';
        }
        return;
      }
      if (!validateStudentIdentity(true)) {
        refreshExamStartGate();
        return;
      }
      nextStep();
    });
    if (els.studentIdentity) {
      els.studentIdentity.addEventListener('input', function () {
        validateStudentIdentity(false);
        refreshExamStartGate();
      });
      els.studentIdentity.addEventListener('change', function () {
        validateStudentIdentity(false);
        refreshExamStartGate();
      });
    }
    $('btnFinishExam').addEventListener('click', finishExam);
    $('btnDownloadReport').addEventListener('click', downloadReport);
    $('btnRestart').addEventListener('click', function () {
      SideNoteGaze.stop();
      stopVisionEngines();
      if (typeof SideNoteAPI !== 'undefined') SideNoteAPI.resetSession();
      detector = null;
      serverSessionId = null;
      lastCalibration = null;
      lastStatus = 'ok';
      lastFlagKey = 'ok';
      studentIdentity = '';
      if (els.studentIdentity) {
        els.studentIdentity.value = '';
        els.studentIdentity.classList.remove('invalid');
      }
      validateStudentIdentity(false);
      resetEnvironmentChecklist();
      if (typeof SideNoteEvidence !== 'undefined') SideNoteEvidence.reset();
      $('btnAfterCal').disabled = true;
      setExamStartEnabled(false);
      $('btnRecalibrate').disabled = true;
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
    var thrLabel = $('accuracyThresholdLabel');
    if (thrLabel) thrLabel.textContent = String(Math.round(accuracyThresholdPx()));
    setExamStartEnabled(false);
    resetEnvironmentChecklist();
    showStep(0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
