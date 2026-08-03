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
  var cameraPaused = false;
  var cameraReconnectBusy = false;
  /** Soft tab-blur note (info, score 0). Skip gaze scoring while the tab is hidden. */
  var TAB_BLUR_SOFT_MS = 1500;
  var tabHidden = false;
  var tabHideStartedAt = null;
  var tabBlurLoggedForHide = false;
  var tabBlurTimer = null;
  var tabBlurWatching = false;

  var els = {};

  /** Instructor-facing labels from docs/FLAG_TAXONOMY.md */
  var FLAG_LABELS = {
    looking_down: 'Looking down (desk / lap)',
    gaze_off_screen: 'Gaze off-screen (side)',
    face_not_visible: 'Face not visible',
    hands_in_lap: 'Hands low / in lap zone',
    phone_risk: 'Possible phone / notes in lap',
    tab_blur: 'Left exam tab'
  };

  var ENV_CHECK_IDS = ['envLighting', 'envDistance', 'envFullscreen'];

  function $(id) { return document.getElementById(id); }

  function bindElements() {
    els.wizard = $('wizard');
    els.gazeDot = $('gazeDot');
    els.calOverlay = $('calOverlay');
    els.statusBadge = $('statusBadge');
    els.statusDetail = $('statusDetail');
    els.currentSignal = $('currentSignal');
    els.currentSignalSeverity = $('currentSignalSeverity');
    els.currentSignalTitle = $('currentSignalTitle');
    els.currentSignalMsg = $('currentSignalMsg');
    els.currentSignalId = $('currentSignalId');
    els.cameraPauseBanner = $('cameraPauseBanner');
    els.cameraPauseMsg = $('cameraPauseMsg');
    els.btnReconnectCamera = $('btnReconnectCamera');
    els.examTimer = $('examTimer');
    els.integrityScore = $('integrityScore');
    els.reportSummary = $('reportSummary');
    els.reportEvents = $('reportEvents');
    els.reportEvidence = $('reportEvidence');
    els.scoreBreakdown = $('scoreBreakdown');
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

  /** Human-facing severity labels — never show raw "CHEATING" / "SUSPICIOUS". */
  function severityDisplayLabel(severity) {
    var s = String(severity || '').toLowerCase();
    if (s === 'suspicious') return 'Needs review';
    if (s === 'warning') return 'Integrity signal';
    if (s === 'info') return 'Note';
    if (s === 'ok') return 'Clear';
    return severity || 'Clear';
  }

  function statusBadgeText(status) {
    return severityDisplayLabel(status);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Live monitor: calm status + single top signal (no scrolling spam). */
  function renderCurrentSignal(status, flags) {
    var top = flags && flags[0] ? flags[0] : null;
    var calm =
      status === 'suspicious'
        ? 'Hold still — an instructor can review this later'
        : status === 'warning'
          ? 'Brief attention drift noted'
          : 'Eyes on the exam';

    if (els.statusDetail) els.statusDetail.textContent = calm;

    if (!top) {
      if (els.currentSignal) els.currentSignal.hidden = true;
      return;
    }

    if (els.currentSignal) {
      els.currentSignal.hidden = false;
      els.currentSignal.setAttribute('data-severity', top.severity || status);
    }
    if (els.currentSignalSeverity) {
      els.currentSignalSeverity.textContent = severityDisplayLabel(top.severity || status);
    }
    if (els.currentSignalTitle) {
      els.currentSignalTitle.textContent = flagInstructorLabel(top.id);
    }
    if (els.currentSignalMsg) {
      els.currentSignalMsg.textContent = top.message || '';
    }
    if (els.currentSignalId) {
      var conf = typeof top.confidence === 'number'
        ? Math.round(top.confidence * 100) + '%'
        : null;
      els.currentSignalId.textContent = conf
        ? (top.id + ' · confidence ' + conf)
        : String(top.id || '');
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

  function clearDetectorTransientState() {
    if (!detector || cameraPaused) return;
    // Drop in-flight dwell so a hidden tab doesn't become face_not_visible
    if (typeof detector.pause === 'function' && typeof detector.resume === 'function') {
      detector.pause();
      detector.resume();
    }
  }

  function logSoftTabBlur(durationMs) {
    if (!detector || cameraPaused) return;

    var secs = Math.max(1, Math.round(durationMs / 1000));
    var flag = {
      id: 'tab_blur',
      severity: 'info',
      confidence: 0.5,
      startedAt: new Date().toISOString(),
      message: 'Left the exam tab for about ' + secs + 's — noted for review, not scored',
      meta: {
        duration_ms: durationMs,
        reason: 'visibilitychange'
      }
    };

    detector.logEvent('info', [flag.message], [flag]);

    if (typeof SideNoteAPI !== 'undefined') {
      SideNoteAPI.recordEvent({
        status: 'info',
        messages: [flag.message],
        flags: [flag],
        flag_id: 'tab_blur',
        severity: 'info',
        confidence: flag.confidence
      });
    }

    if (els.statusDetail && !cameraPaused) {
      els.statusDetail.textContent =
        'Note: left the exam tab (~' + secs + 's) — soft signal, not scored';
    }

    if (typeof console !== 'undefined' && console.log) {
      console.log('[SideNote] Soft tab_blur note', { duration_ms: durationMs });
    }
  }

  function onExamVisibilityChange() {
    if (currentStep !== STEPS.indexOf('exam')) return;

    if (document.hidden) {
      tabHidden = true;
      tabHideStartedAt = Date.now();
      tabBlurLoggedForHide = false;
      if (els.gazeDot) els.gazeDot.style.display = 'none';

      if (tabBlurTimer) clearTimeout(tabBlurTimer);
      tabBlurTimer = setTimeout(function () {
        tabBlurTimer = null;
        if (!document.hidden || tabBlurLoggedForHide || cameraPaused) return;
        tabBlurLoggedForHide = true;
        var dur = tabHideStartedAt ? (Date.now() - tabHideStartedAt) : TAB_BLUR_SOFT_MS;
        logSoftTabBlur(dur);
      }, TAB_BLUR_SOFT_MS);
      return;
    }

    // Visible again
    if (tabBlurTimer) {
      clearTimeout(tabBlurTimer);
      tabBlurTimer = null;
    }
    var wasHidden = tabHidden;
    tabHidden = false;
    tabHideStartedAt = null;
    if (wasHidden) {
      clearDetectorTransientState();
      faceMissStreak = 0;
      if (!cameraPaused && els.statusDetail && !tabBlurLoggedForHide) {
        // Brief hide under soft threshold — no log, keep calm
        els.statusDetail.textContent = 'Eyes on the exam';
      }
    }
  }

  function startTabBlurWatch() {
    if (tabBlurWatching) return;
    tabBlurWatching = true;
    document.addEventListener('visibilitychange', onExamVisibilityChange);
  }

  function stopTabBlurWatch() {
    if (!tabBlurWatching) return;
    tabBlurWatching = false;
    document.removeEventListener('visibilitychange', onExamVisibilityChange);
    if (tabBlurTimer) {
      clearTimeout(tabBlurTimer);
      tabBlurTimer = null;
    }
    tabHidden = false;
    tabHideStartedAt = null;
    tabBlurLoggedForHide = false;
  }

  function setCameraPausedUI(paused, reason) {
    cameraPaused = !!paused;

    if (els.cameraPauseBanner) {
      els.cameraPauseBanner.hidden = !paused;
    }
    if (els.cameraPauseMsg && reason) {
      els.cameraPauseMsg.textContent = reason;
    }
    if (els.btnReconnectCamera) {
      els.btnReconnectCamera.disabled = false;
      els.btnReconnectCamera.textContent = 'Reconnect camera';
    }

    if (els.gazeDot) els.gazeDot.style.display = 'none';

    if (!paused) {
      if (els.statusBadge) {
        els.statusBadge.classList.remove('is-paused');
      }
      return;
    }

    if (els.statusBadge) {
      els.statusBadge.textContent = 'Paused';
      els.statusBadge.style.background = '#8a7d6e';
      els.statusBadge.setAttribute('data-status', 'paused');
      els.statusBadge.setAttribute('title', 'Camera unavailable — integrity scoring paused');
      els.statusBadge.classList.add('is-paused');
    }
    if (els.statusDetail) {
      els.statusDetail.textContent = 'Scoring paused — reconnect the camera to continue';
    }
    if (els.currentSignal) els.currentSignal.hidden = true;
  }

  function onCameraAvailability(isLive) {
    if (currentStep !== STEPS.indexOf('exam')) return;

    if (!isLive) {
      if (cameraPaused) return;
      if (detector) detector.pause();
      lastStatus = 'paused';
      lastFlagKey = 'paused';
      setCameraPausedUI(
        true,
        'Scoring is paused until the webcam is back. Allow camera access in the browser, then reconnect.'
      );
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[SideNote] Camera lost — scoring paused');
      }
      return;
    }

    if (!cameraPaused) return;
    resumeAfterCameraRestore();
  }

  function resumeAfterCameraRestore() {
    if (detector) detector.resume();
    setCameraPausedUI(false);
    lastStatus = 'ok';
    lastFlagKey = 'ok';
    faceMissStreak = 0;
    setProctorStatus({ status: 'ok', messages: [], color: '#7a9e6a', flags: [] });
    if (typeof SideNoteGaze !== 'undefined') SideNoteGaze.resetSmoothing();
    if (typeof console !== 'undefined' && console.log) {
      console.log('[SideNote] Camera restored — scoring resumed');
    }
  }

  function reconnectCamera() {
    if (cameraReconnectBusy) return Promise.resolve();
    if (!els.btnReconnectCamera) return Promise.resolve();

    cameraReconnectBusy = true;
    els.btnReconnectCamera.disabled = true;
    els.btnReconnectCamera.textContent = 'Reconnecting…';

    if (typeof SideNoteGaze === 'undefined') {
      cameraReconnectBusy = false;
      els.btnReconnectCamera.disabled = false;
      els.btnReconnectCamera.textContent = 'Reconnect camera';
      return Promise.resolve();
    }

    // Force a fresh begin() so the browser re-prompts if permission was revoked
    try { SideNoteGaze.stop(); } catch (e) {}

    return SideNoteGaze.start(onGaze)
      .then(function () {
        SideNoteGaze.styleWebGazerPreview();
        return startVisionEngines();
      })
      .then(function () {
        SideNoteGaze.watchCamera(onCameraAvailability);
        if (SideNoteGaze.isCameraLive()) {
          resumeAfterCameraRestore();
        } else {
          setCameraPausedUI(
            true,
            'Still no live camera. Check the browser address-bar camera permission, then try again.'
          );
        }
      })
      .catch(function (err) {
        var msg = (err && err.message) ? err.message : 'Could not restart the camera.';
        setCameraPausedUI(
          true,
          msg + ' Allow camera access, then try Reconnect again.'
        );
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[SideNote] Camera reconnect failed', err);
        }
      })
      .then(function () {
        cameraReconnectBusy = false;
        if (els.btnReconnectCamera) {
          els.btnReconnectCamera.disabled = false;
          els.btnReconnectCamera.textContent = 'Reconnect camera';
        }
      });
  }

  function setProctorStatus(result) {
    if (!els.statusBadge) return;
    if (cameraPaused) return;

    result = result || { status: 'ok', messages: [], color: '#7a9e6a', flags: [] };
    var status = result.status || 'ok';
    var flags = result.flags || [];
    var messages = result.messages && result.messages.length
      ? result.messages
      : flags.map(function (f) { return f.message; }).filter(Boolean);
    var color = result.color || '#7a9e6a';
    var topFlag = flags[0] || null;
    var flagKey = topFlag ? (topFlag.id + ':' + topFlag.severity) : status;

    els.statusBadge.textContent = statusBadgeText(status);
    els.statusBadge.style.background = color;
    els.statusBadge.setAttribute('data-status', status);
    els.statusBadge.setAttribute(
      'title',
      status === 'suspicious'
        ? 'Needs review — integrity signal for an instructor, not a cheating verdict'
        : status === 'warning'
          ? 'Integrity signal — brief or ambiguous attention drift'
          : 'Clear — no active integrity signals'
    );
    renderCurrentSignal(status, flags);

    if (status !== lastStatus || flagKey !== lastFlagKey) {
      if (detector && status !== 'ok') {
        detector.logEvent(status, messages, flags);
      }
      if (typeof SideNoteAPI !== 'undefined' && status !== 'ok') {
        SideNoteAPI.recordEvent({
          status: status,
          messages: messages,
          flags: flags,
          flag_id: topFlag ? topFlag.id : null,
          severity: topFlag ? topFlag.severity : status,
          confidence: topFlag && typeof topFlag.confidence === 'number'
            ? topFlag.confidence
            : null
        });
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
      // Needs-review + phone_risk → 2–3s JPEG burst from webcam
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

  /**
   * Face presence: fuse MediaPipe Face Mesh + WebGazer.
   * Face Mesh alone false-negatives under CPU load (or before first hit) while
   * WebGazer is still tracking eyes — that used to spam face_not_visible and
   * blocked looking_down / phone_risk / off-screen assessments.
   */
  var FACE_VISIBLE_MAX_AGE_MS = 2200;

  function readFaceVisible(maxAgeMs) {
    maxAgeMs = maxAgeMs == null ? FACE_VISIBLE_MAX_AGE_MS : maxAgeMs;
    var meshVisible = false;
    var gazeVisible = false;

    if (typeof SideNoteFace !== 'undefined' && SideNoteFace.isReady()) {
      meshVisible = SideNoteFace.isFaceVisible(maxAgeMs);
    }
    if (typeof SideNoteGaze !== 'undefined') {
      gazeVisible = SideNoteGaze.isFaceVisible(maxAgeMs);
    }

    // Either source is enough. Prefer requiring at least one when both engines exist.
    if (typeof SideNoteFace !== 'undefined' && SideNoteFace.isReady()) {
      return meshVisible || gazeVisible;
    }
    if (typeof SideNoteGaze !== 'undefined') {
      return gazeVisible;
    }
    return true;
  }

  function readHeadPose() {
    if (typeof SideNoteFace === 'undefined' || !SideNoteFace.isReady()) return null;
    // Only trust pose while Mesh itself recently saw a face (not WebGazer fallback)
    if (!SideNoteFace.isFaceVisible(FACE_VISIBLE_MAX_AGE_MS)) return null;
    return SideNoteFace.getHeadPose();
  }

  function readFacesCount() {
    if (typeof SideNoteFace === 'undefined' || !SideNoteFace.isReady()) return null;
    if (!SideNoteFace.isFaceVisible(FACE_VISIBLE_MAX_AGE_MS)) {
      // WebGazer may still see a face — report unknown rather than stale 0
      return null;
    }
    return SideNoteFace.getFacesCount();
  }

  /** MediaPipe Hands → { inLap, count } for phone_risk co-occurrence */
  function readHands() {
    if (typeof SideNoteHands === 'undefined' || !SideNoteHands.isReady()) return null;
    return SideNoteHands.getHands();
  }

  function buildDetectorInput(gazeSample, faceVisible) {
    var visible = !!faceVisible;
    return {
      gaze: visible ? gazeSample : null,
      faceVisible: visible,
      hands: visible ? readHands() : null,
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
    // Parallel — each engine waits briefly for WebGazer's video element
    return Promise.all([startFaceEngine(), startHandEngine()]).then(function () {
      return true;
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
    if (cameraPaused || tabHidden || document.hidden) return;
    if (typeof SideNoteGaze !== 'undefined' && !SideNoteGaze.isCameraLive()) {
      onCameraAvailability(false);
      return;
    }

    // Fresh gaze sample ⇒ eyes were detected this frame (authoritative for presence)
    var faceVisible = readFaceVisible(FACE_VISIBLE_MAX_AGE_MS) ||
      (typeof sample.x === 'number' && typeof sample.y === 'number');
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
    if (cameraPaused || tabHidden || document.hidden) return;
    if (typeof SideNoteGaze !== 'undefined' && !SideNoteGaze.isCameraLive()) {
      onCameraAvailability(false);
      return;
    }

    if (readFaceVisible(FACE_VISIBLE_MAX_AGE_MS)) {
      faceMissStreak = 0;
      return;
    }

    // Require sustained absence (~2.5s at 250ms) before escalating — avoid flicker
    faceMissStreak += 1;
    if (faceMissStreak > 10) {
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
        // Best-effort reset; never block continuing if clearData is flaky
        return SideNoteGaze.clearTrainingData().catch(function () { return null; });
      })
      .then(function () {
        SideNoteGaze.styleWebGazerPreview();
        // Warm Face Mesh + Hands on the same video during checklist/calibration
        startVisionEngines();
        btn.disabled = false;
        btn.textContent = 'Camera ready';
        nextStep();
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = 'Allow camera & continue';
        var msg = (err && err.message) ? err.message : String(err);
        alert(msg);
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
          if (hasStudentIdentity()) {
            msg += 'Passed — you can start the exam.';
          } else {
            msg += 'Passed accuracy — enter your name or email below to unlock Start exam.';
            if (els.studentIdentity) {
              try { els.studentIdentity.focus(); } catch (e) {}
            }
            if (els.studentIdentityHint) {
              els.studentIdentityHint.textContent =
                'Accuracy passed. Enter your name or email to unlock Start exam.';
              els.studentIdentityHint.className = 'identity-hint';
            }
          }
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

  function waitForCameraLive(timeoutMs) {
    timeoutMs = timeoutMs || 5000;
    return new Promise(function (resolve) {
      if (typeof SideNoteGaze === 'undefined') {
        resolve(false);
        return;
      }
      var started = Date.now();
      function tick() {
        if (SideNoteGaze.isCameraLive && SideNoteGaze.isCameraLive()) {
          resolve(true);
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(tick, 200);
      }
      tick();
    });
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
    cameraPaused = false;
    tabHidden = false;
    tabBlurLoggedForHide = false;
    if (typeof SideNoteEvidence !== 'undefined') SideNoteEvidence.reset();
    setCameraPausedUI(false);
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
    }).then(function () {
      // Wait for WebGazer video tracks before treating missing camera as a pause
      return waitForCameraLive(5000);
    }).then(function (live) {
      SideNoteGaze.watchCamera(onCameraAvailability);
      if (!live) {
        onCameraAvailability(false);
      }
    });

    startTabBlurWatch();

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
    if (typeof SideNoteGaze !== 'undefined') SideNoteGaze.unwatchCamera();
    stopTabBlurWatch();
    cameraPaused = false;

    var online = typeof SideNoteAPI !== 'undefined' && SideNoteAPI.isOnline();
    var btn = $('btnFinishExam');
    if (btn) {
      btn.disabled = true;
      btn.textContent = online ? 'Saving…' : 'Finishing…';
    }

    var wait = typeof SideNoteEvidence !== 'undefined' && SideNoteEvidence.whenIdle
      ? SideNoteEvidence.whenIdle(2500)
      : Promise.resolve(true);

    wait.then(function () {
      SideNoteGaze.stop();
      stopVisionEngines();
      if (els.gazeDot) els.gazeDot.style.display = 'none';

      if (detector && online) {
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
        '<p class="evidence-empty">No snapshots captured this session. Needs-review and phone_risk integrity signals save webcam stills here.</p>';
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

  function summarizeScoreDeductions(events) {
    var phoneRisk = 0;
    var otherNeedsReview = 0;
    var integritySignals = 0;
    var deducted = 0;

    (events || []).forEach(function (e) {
      var phoneSus = (e.flags || []).some(function (f) {
        return f.id === 'phone_risk' && f.severity === 'suspicious';
      });
      if (phoneSus || e.status === 'suspicious') {
        if (phoneSus) {
          phoneRisk += 1;
          deducted += 12;
        } else {
          otherNeedsReview += 1;
          deducted += 8;
        }
      } else if (e.status === 'warning') {
        integritySignals += 1;
        deducted += 2;
      }
    });

    return {
      phoneRisk: phoneRisk,
      otherNeedsReview: otherNeedsReview,
      integritySignals: integritySignals,
      deducted: deducted,
      score: Math.max(0, 100 - deducted)
    };
  }

  function renderScoreBreakdown(events, integrityScore) {
    if (!els.scoreBreakdown) return;
    var s = summarizeScoreDeductions(events);
    var parts = [];
    if (s.phoneRisk) {
      parts.push(s.phoneRisk + '× phone_risk (−12)');
    }
    if (s.otherNeedsReview) {
      parts.push(s.otherNeedsReview + '× needs review (−8)');
    }
    if (s.integritySignals) {
      parts.push(s.integritySignals + '× integrity signal (−2)');
    }

    var finalScore = integrityScore != null ? integrityScore : s.score;
    if (!parts.length) {
      els.scoreBreakdown.textContent =
        'This session: 100 − 0 = ' + finalScore + ' (no deductions).';
      return;
    }

    els.scoreBreakdown.textContent =
      'This session: 100 − (' + parts.join(' + ') + ') = ' + finalScore + '.';
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
        '<p><strong>Integrity signals:</strong> ' + report.warningCount +
          ' · <strong>Needs review:</strong> ' + report.suspiciousCount + '</p>' +
        '<p><strong>Evidence snapshots:</strong> ' +
          (report.evidence ? report.evidence.length : 0) +
          ' / ' +
          (typeof SideNoteEvidence !== 'undefined' ? SideNoteEvidence.MAX_ITEMS : 8) +
          ' max</p>' +
        (typeof SideNoteAPI !== 'undefined' && SideNoteAPI.isOnline() && (serverSessionId || SideNoteAPI.getSessionId())
          ? '<p class="ok-msg" style="color:var(--ok)">Report saved on the server.</p>'
          : '<p class="report-offline-note"><strong>Session not saved</strong> — backend was offline. Download the JSON report to keep a local copy.</p>');
    }
    renderScoreBreakdown(report.events, report.integrityScore);
    renderEvidence(report.evidence);
    if (els.reportEvents) {
      els.reportEvents.innerHTML = report.events.length
        ? report.events.map(function (e) {
            var top = (e.flags && e.flags[0]) || null;
            var detail = top
              ? ('<span class="log-flag-id">' + escapeHtml(top.id) + '</span> [' +
                 escapeHtml(severityDisplayLabel(top.severity)) + '] — ' +
                 escapeHtml(flagInstructorLabel(top.id)))
              : escapeHtml(e.messages.join('; '));
            return '<li class="' + e.status + '">' + e.time + ' — ' + detail + '</li>';
          }).join('')
        : '<li class="ok-msg">No integrity signals recorded — clear session.</li>';
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
        var out = $('validationResult');
        if (
          out &&
          calibrationPassed() &&
          hasStudentIdentity() &&
          /enter your name or email/i.test(out.textContent || '')
        ) {
          out.textContent = (out.textContent || '').replace(
            /Passed accuracy — enter your name or email below to unlock Start exam\./i,
            'Passed — you can start the exam.'
          );
        }
      });
      els.studentIdentity.addEventListener('change', function () {
        validateStudentIdentity(false);
        refreshExamStartGate();
      });
    }
    $('btnFinishExam').addEventListener('click', finishExam);
    if (els.btnReconnectCamera) {
      els.btnReconnectCamera.addEventListener('click', function () {
        reconnectCamera();
      });
    }
    $('btnDownloadReport').addEventListener('click', downloadReport);
    $('btnRestart').addEventListener('click', function () {
      if (typeof SideNoteGaze !== 'undefined') SideNoteGaze.unwatchCamera();
      SideNoteGaze.stop();
      stopVisionEngines();
      stopTabBlurWatch();
      if (typeof SideNoteAPI !== 'undefined') SideNoteAPI.resetSession();
      detector = null;
      serverSessionId = null;
      lastCalibration = null;
      lastStatus = 'ok';
      lastFlagKey = 'ok';
      cameraPaused = false;
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
    var offlineBanner = $('offlineBanner');

    function showWebGazer(src) {
      el.textContent = 'Camera tracking is ready (' + src + '). Chrome or Edge works best.';
      el.className = 'lib-status ok';
    }

    function setOfflineBanner(show) {
      if (!offlineBanner) return;
      offlineBanner.hidden = !show;
    }

    function showBackendStatus(online) {
      setOfflineBanner(!online);
      if (!apiEl) return;
      if (online) {
        apiEl.textContent = 'Server connected — your session will be saved automatically.';
        apiEl.className = 'lib-status ok';
      } else {
        apiEl.textContent = 'Offline — session not saved. The demo still works in your browser (download JSON later).';
        apiEl.className = 'lib-status warn';
      }
    }

    SideNoteGaze.waitForWebGazer().then(function () {
      showWebGazer(window._webgazerSource || 'loaded');
    }).catch(function (err) {
      el.textContent = err.message;
      el.className = 'lib-status err';
    });

    if (typeof SideNoteAPI !== 'undefined') {
      SideNoteAPI.startHealthMonitor(showBackendStatus);
    } else {
      setOfflineBanner(true);
      if (apiEl) {
        apiEl.textContent = 'Offline — session not saved. The demo still works in your browser.';
        apiEl.className = 'lib-status warn';
      }
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
