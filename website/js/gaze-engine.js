/**
 * Side Note — WebGazer wrapper: calibration, smoothing, validation.
 */
(function (global) {
  'use strict';

  var SMOOTH_ALPHA = 0.25;
  var CAL_BURST_SAMPLES = 4;
  var CAL_BURST_GAP_MS = 160;
  var CAL_POINTS = [
    [0.08, 0.08], [0.5, 0.08], [0.92, 0.08],
    [0.08, 0.5], [0.5, 0.5], [0.92, 0.5],
    [0.08, 0.92], [0.5, 0.92], [0.92, 0.92]
  ];

  var state = {
    active: false,
    calibrating: false,
    validating: false,
    smoothX: null,
    smoothY: null,
    latestGaze: null,
    listener: null,
    rafId: null,
    lastFaceTime: 0,
    lastDeliverMs: 0,
    trainingPoints: 0
  };

  function hasWebGazer() {
    return typeof global.webgazer !== 'undefined';
  }

  function boundGaze(raw) {
    if (!raw || typeof raw.x !== 'number' || typeof raw.y !== 'number') return null;
    if (isNaN(raw.x) || isNaN(raw.y)) return null;
    if (global.webgazer && global.webgazer.util && typeof global.webgazer.util.bound === 'function') {
      return global.webgazer.util.bound({ x: raw.x, y: raw.y });
    }
    return {
      x: Math.max(0, Math.min(raw.x, global.innerWidth)),
      y: Math.max(0, Math.min(raw.y, global.innerHeight))
    };
  }

  function smoothGaze(raw) {
    var b = boundGaze(raw);
    if (!b) return null;
    if (state.smoothX == null) {
      state.smoothX = b.x;
      state.smoothY = b.y;
    } else {
      state.smoothX = state.smoothX + SMOOTH_ALPHA * (b.x - state.smoothX);
      state.smoothY = state.smoothY + SMOOTH_ALPHA * (b.y - state.smoothY);
    }
    return { x: state.smoothX, y: state.smoothY, raw: b };
  }

  function resetSmoothing() {
    state.smoothX = null;
    state.smoothY = null;
  }

  function markFaceSeen() {
    state.lastFaceTime = Date.now();
  }

  function isFaceVisible(maxAgeMs) {
    maxAgeMs = maxAgeMs == null ? 2200 : maxAgeMs;
    return state.lastFaceTime > 0 && (Date.now() - state.lastFaceTime) < maxAgeMs;
  }

  function deliverToListener(raw) {
    if (!state.active || state.calibrating || !state.listener) return;
    var b = boundGaze(raw);
    if (!b) return;

    state.latestGaze = b;
    markFaceSeen();

    var now = Date.now();
    if (now - state.lastDeliverMs < 16) return;
    state.lastDeliverMs = now;

    var s = smoothGaze(raw);
    if (s) state.listener(s);
  }

  function readPrediction() {
    if (!hasWebGazer()) return Promise.resolve(null);

    var wg = global.webgazer;
    if (typeof wg.getCurrentPrediction !== 'function') {
      return Promise.resolve(state.latestGaze);
    }

    try {
      var result = wg.getCurrentPrediction();
      if (result && typeof result.then === 'function') {
        return result.then(function (p) {
          var b = boundGaze(p);
          if (b) {
            state.latestGaze = b;
            markFaceSeen();
          }
          return b || null;
        }).catch(function () {
          return null;
        });
      }
      var b = boundGaze(result);
      if (b) {
        state.latestGaze = b;
        markFaceSeen();
      }
      return Promise.resolve(b || null);
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  function onGazeData(data) {
    if (!state.active) return;
    var b = boundGaze(data);
    if (b) {
      state.latestGaze = b;
      markFaceSeen();
    }
    if (!state.calibrating && !state.validating) {
      deliverToListener(data);
    }
  }

  function styleWebGazerPreview() {
    var ids = ['webgazerVideoContainer', 'webgazerVideoFeed', 'webgazerCanvas'];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.style.setProperty('position', 'fixed', 'important');
      el.style.setProperty('bottom', '16px', 'important');
      el.style.setProperty('left', '16px', 'important');
      el.style.setProperty('top', 'auto', 'important');
      el.style.setProperty('right', 'auto', 'important');
      el.style.setProperty('width', '160px', 'important');
      el.style.setProperty('height', 'auto', 'important');
      el.style.setProperty('border-radius', '8px', 'important');
      el.style.setProperty('border', '2px solid rgba(196,120,74,0.4)', 'important');
      el.style.setProperty('z-index', '9990', 'important');
      el.style.setProperty('opacity', '0.85', 'important');
      el.style.setProperty('pointer-events', 'none', 'important');
    });
  }

  function getVideoElement() {
    return (
      document.getElementById('webgazerVideoFeed') ||
      document.querySelector('#webgazerVideoContainer video') ||
      document.querySelector('video#webgazerVideoFeed') ||
      null
    );
  }

  /** True when WebGazer's video has at least one live, enabled track. */
  function isCameraLive() {
    var video = getVideoElement();
    if (!video) return false;
    var stream = video.srcObject;
    if (!stream || typeof stream.getVideoTracks !== 'function') {
      // Fallback: video element still playing frames
      return !!(video.readyState >= 2 && !video.paused && video.videoWidth > 0);
    }
    var tracks = stream.getVideoTracks();
    if (!tracks.length) return false;
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      // ended / permanently muted = unavailable; ignore transient mute flicker by
      // requiring readyState !== 'live' or enabled === false as the hard fail.
      if (t && t.readyState === 'live' && t.enabled !== false) {
        return true;
      }
    }
    return false;
  }

  var cameraWatch = {
    pollId: null,
    tracks: [],
    handlers: [],
    onChange: null,
    lastLive: null,
    permStatus: null
  };

  function detachTrackHandlers() {
    cameraWatch.handlers.forEach(function (h) {
      try {
        h.track.removeEventListener('ended', h.onEnded);
        h.track.removeEventListener('mute', h.onMute);
        h.track.removeEventListener('unmute', h.onUnmute);
      } catch (e) {}
    });
    cameraWatch.handlers = [];
    cameraWatch.tracks = [];
  }

  function attachTrackHandlers(stream) {
    detachTrackHandlers();
    if (!stream || typeof stream.getVideoTracks !== 'function') return;
    stream.getVideoTracks().forEach(function (track) {
      var onEnded = function () { emitCameraChange(); };
      var onMute = function () { emitCameraChange(); };
      var onUnmute = function () { emitCameraChange(); };
      track.addEventListener('ended', onEnded);
      track.addEventListener('mute', onMute);
      track.addEventListener('unmute', onUnmute);
      cameraWatch.handlers.push({ track: track, onEnded: onEnded, onMute: onMute, onUnmute: onUnmute });
      cameraWatch.tracks.push(track);
    });
  }

  function emitCameraChange() {
    if (!cameraWatch.onChange) return;
    var live = isCameraLive();
    // Grace: while gaze is active but video not mounted yet, don't flip to "lost"
    if (!live && state.active && cameraWatch.lastLive !== true) {
      var video = getVideoElement();
      if (!video) return;
    }
    if (cameraWatch.lastLive === live) return;
    cameraWatch.lastLive = live;
    try {
      cameraWatch.onChange(live);
    } catch (e) {}
  }

  /**
   * Watch WebGazer camera health. Calls onChange(isLive) when availability flips.
   * Covers track ended, mute, permission revoke, and a light poll backup.
   */
  function watchCamera(onChange) {
    unwatchCamera();
    cameraWatch.onChange = typeof onChange === 'function' ? onChange : null;
    cameraWatch.lastLive = null;

    var video = getVideoElement();
    if (video && video.srcObject) {
      attachTrackHandlers(video.srcObject);
    }

    cameraWatch.pollId = global.setInterval(function () {
      var v = getVideoElement();
      if (v && v.srcObject && cameraWatch.tracks.indexOf((v.srcObject.getVideoTracks() || [])[0]) < 0) {
        attachTrackHandlers(v.srcObject);
      }
      emitCameraChange();
    }, 1000);

    if (global.navigator && global.navigator.permissions && typeof global.navigator.permissions.query === 'function') {
      try {
        global.navigator.permissions.query({ name: 'camera' }).then(function (status) {
          cameraWatch.permStatus = status;
          var onPerm = function () {
            if (status.state === 'denied') {
              if (cameraWatch.lastLive !== false) {
                cameraWatch.lastLive = false;
                if (cameraWatch.onChange) cameraWatch.onChange(false);
              }
            } else {
              emitCameraChange();
            }
          };
          status.addEventListener('change', onPerm);
          cameraWatch.permOnChange = onPerm;
          onPerm();
        }).catch(function () {});
      } catch (e) {}
    }

    emitCameraChange();
  }

  function unwatchCamera() {
    if (cameraWatch.pollId != null) {
      global.clearInterval(cameraWatch.pollId);
      cameraWatch.pollId = null;
    }
    detachTrackHandlers();
    if (cameraWatch.permStatus && cameraWatch.permOnChange) {
      try {
        cameraWatch.permStatus.removeEventListener('change', cameraWatch.permOnChange);
      } catch (e) {}
    }
    cameraWatch.permStatus = null;
    cameraWatch.permOnChange = null;
    cameraWatch.onChange = null;
    cameraWatch.lastLive = null;
  }

  function setWebGazerDebug(show) {
    if (!hasWebGazer()) return;
    var wg = global.webgazer;
    if (typeof wg.showPredictionPoints === 'function') wg.showPredictionPoints(!!show);
    if (wg.params) wg.params.showGazeDot = !!show;
  }

  function configureWebGazer() {
    var wg = global.webgazer;
    if (!wg) return;

    // WebGazer defaults saveDataAcrossSessions=true; corrupted IndexedDB
    // data can throw "t is not a function" inside begin()/clearData().
    if (typeof wg.saveDataAcrossSessions === 'function') {
      try { wg.saveDataAcrossSessions(false); } catch (e0) {}
    }
    if (wg.params) {
      wg.params.saveDataAcrossSessions = false;
      // Default "./mediapipe/face_mesh" is not shipped — begin() then dies in
      // TFFaceMesh.init with "t is not a function" after the camera preview appears.
      wg.params.faceMeshSolutionPath =
        global.SIDE_NOTE_WEBGZER_FACE_MESH_CDN ||
        'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619';
      wg.params.showVideo = true;
      wg.params.showFaceOverlay = false;
      wg.params.showFaceFeedbackBox = true;
      wg.params.showGazeDot = false;
      wg.params.moveTickSize = 50;
    }

    if (typeof wg.setRegression === 'function') {
      try { wg.setRegression('ridge'); } catch (e1) {
        try { wg.setRegression('weightedRidge'); } catch (e2) {}
      }
    }
    if (typeof wg.setTracker === 'function') {
      try { wg.setTracker('TFFacemesh'); } catch (e) {}
    }
    if (typeof wg.applyKalmanFilter === 'function') {
      try { wg.applyKalmanFilter(true); } catch (e) {}
    }
    setWebGazerDebug(false);
    if (typeof wg.showVideo === 'function') wg.showVideo(true);
    else if (typeof wg.showVideoPreview === 'function') wg.showVideoPreview(true);

    global.setTimeout(styleWebGazerPreview, 500);
    global.setTimeout(styleWebGazerPreview, 2000);
  }

  function disableMouseCalibration() {
    if (hasWebGazer() && typeof global.webgazer.removeMouseEventListeners === 'function') {
      global.webgazer.removeMouseEventListeners();
    }
  }

  /**
   * Record a training pair at screen position (px, py).
   * Must run getCurrentPrediction first so WebGazer has fresh eye features.
   */
  function recordTrainingPoint(px, py) {
    if (!hasWebGazer()) return Promise.resolve(false);
    var wg = global.webgazer;
    if (typeof wg.recordScreenPosition !== 'function') return Promise.resolve(false);

    return readPrediction().then(function () {
      try {
        wg.recordScreenPosition(px, py, 'click');
        state.trainingPoints += 1;
        return true;
      } catch (e) {
        return false;
      }
    });
  }

  function recordBurst(px, py, count) {
    var recorded = 0;
    function step(i) {
      if (i >= count) return Promise.resolve(recorded);
      return recordTrainingPoint(px, py).then(function (ok) {
        if (ok) recorded += 1;
        return waitMs(CAL_BURST_GAP_MS).then(function () { return step(i + 1); });
      });
    }
    return step(0);
  }

  function clearTrainingData() {
    var wg = global.webgazer;
    if (!wg) return Promise.resolve();
    state.latestGaze = null;
    state.trainingPoints = 0;
    state.lastFaceTime = 0;
    resetSmoothing();
    disableMouseCalibration();
    if (typeof wg.saveDataAcrossSessions === 'function') {
      try { wg.saveDataAcrossSessions(false); } catch (e0) {}
    }
    if (wg.params) wg.params.saveDataAcrossSessions = false;
    if (typeof wg.clearData === 'function') {
      try {
        return Promise.resolve(wg.clearData()).catch(function () {
          return null;
        });
      } catch (e) {
        return Promise.resolve();
      }
    }
    return Promise.resolve();
  }

  function waitForWebGazer(maxAttempts, intervalMs) {
    maxAttempts = maxAttempts || 80;
    intervalMs = intervalMs || 200;
    return new Promise(function (resolve, reject) {
      var attempts = 0;
      function tick() {
        if (hasWebGazer()) return resolve(global.webgazer);
        attempts += 1;
        if (attempts >= maxAttempts) {
          return reject(new Error('WebGazer failed to load. Open http://localhost:8000/demo.html in Chrome or Edge.'));
        }
        global.setTimeout(tick, intervalMs);
      }
      tick();
    });
  }

  function waitForVideoReady(timeoutMs) {
    timeoutMs = timeoutMs || 10000;
    return new Promise(function (resolve) {
      var waited = 0;
      var tick = global.setInterval(function () {
        var wg = global.webgazer;
        if (wg && typeof wg.isReady === 'function' && wg.isReady()) {
          global.clearInterval(tick);
          resolve(true);
          return;
        }
        waited += 200;
        if (waited >= timeoutMs) {
          global.clearInterval(tick);
          resolve(false);
        }
      }, 200);
    });
  }

  function start(onGaze) {
    if (state.active) {
      state.listener = onGaze || state.listener;
      return Promise.resolve();
    }
    return waitForWebGazer().then(function () {
      configureWebGazer();
      state.listener = onGaze || null;

      var wg = global.webgazer;
      if (typeof wg.setGazeListener !== 'function' || typeof wg.begin !== 'function') {
        throw new Error('WebGazer loaded incorrectly. Hard-refresh the page and try Chrome or Edge.');
      }

      wg.setGazeListener(onGazeData);

      // begin([onFail]) — onFail must be a function; omit and use promise catch
      var beginResult;
      try {
        beginResult = wg.begin();
      } catch (err) {
        var msg = (err && err.message) ? err.message : String(err);
        if (/is not a function/i.test(msg) || /Failed to fetch|Load failed|404/i.test(msg)) {
          throw new Error(
            'Eye tracker face model failed to load. Check your network (jsDelivr CDN), hard-refresh, and try again in Chrome.'
          );
        }
        throw err;
      }

      return Promise.resolve(beginResult).then(function () {
        return waitForVideoReady(12000);
      }).then(function (ready) {
        if (!ready) {
          throw new Error('Camera not ready. Allow camera access and try again.');
        }
        state.active = true;
        resetSmoothing();
        disableMouseCalibration();

        function loop() {
          if (!state.active) return;
          readPrediction().then(function (b) {
            if (b) {
              state.latestGaze = b;
              markFaceSeen();
            }
          });
          state.rafId = global.requestAnimationFrame(loop);
        }
        state.rafId = global.requestAnimationFrame(loop);
      }).catch(function (err) {
        var msg = (err && err.message) ? err.message : String(err);
        if (/is not a function/i.test(msg) || /Failed to fetch|Load failed|404/i.test(msg)) {
          throw new Error(
            'Eye tracker face model failed to load. Check your network (jsDelivr CDN), hard-refresh, and try again in Chrome.'
          );
        }
        throw err;
      });
    });
  }

  function stop() {
    state.active = false;
    state.validating = false;
    if (state.rafId != null) {
      global.cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
    try {
      if (hasWebGazer()) global.webgazer.end();
    } catch (e) {}
    resetSmoothing();
    state.latestGaze = null;
    state.lastFaceTime = 0;
    unwatchCamera();
  }

  function waitMs(ms) {
    return new Promise(function (resolve) { global.setTimeout(resolve, ms); });
  }

  /**
   * 9-point calibration: look at circle, click it (or press Space).
   * Records training at the circle center, not the mouse position.
   */
  function runCalibration(overlayEl, onProgress) {
    if (!overlayEl) return Promise.reject(new Error('Calibration overlay missing'));

    state.calibrating = true;
    var completed = 0;
    var cancelled = false;
    var totalSamples = 0;

    return clearTrainingData().then(function () {
      setWebGazerDebug(false);
      return waitForVideoReady(8000);
    }).then(function (ready) {
      if (!ready) {
        throw new Error('Camera not ready. Check permissions and reload the page.');
      }
      return showPoint(0);
    }).then(function () {
      overlayEl.classList.remove('visible');
      overlayEl.innerHTML = '';
      state.calibrating = false;
      resetSmoothing();
      return {
        pointsCompleted: completed,
        cancelled: cancelled,
        totalSamples: totalSamples,
        trainingPoints: state.trainingPoints
      };
    }).catch(function (err) {
      overlayEl.classList.remove('visible');
      overlayEl.innerHTML = '';
      state.calibrating = false;
      throw err;
    });

    function showPoint(index) {
      if (cancelled || index >= CAL_POINTS.length) return Promise.resolve();

      var nx = CAL_POINTS[index][0];
      var ny = CAL_POINTS[index][1];
      var px = nx * global.innerWidth;
      var py = ny * global.innerHeight;

      overlayEl.innerHTML =
        '<div class="cal-backdrop">' +
          '<div class="cal-instructions">' +
            '<h2>Point ' + (index + 1) + ' of ' + CAL_POINTS.length + '</h2>' +
            '<p><strong>Look at the circle</strong>, then <strong>click it</strong> (or press Space).</p>' +
            '<p id="calPhase" class="cal-tip">Keep your head still — move only your eyes to the circle.</p>' +
            '<p id="calSamples" class="cal-tip" style="font-size:0.8rem"></p>' +
          '</div>' +
          '<button type="button" class="cal-target" id="calTarget" aria-label="Calibration point ' + (index + 1) + '" style="left:' + px + 'px;top:' + py + 'px;">' +
            '<span class="cal-target-ring"></span>' +
            '<span class="cal-target-core"></span>' +
          '</button>' +
          '<button type="button" class="btn btn-secondary cal-skip" id="calCancel">Cancel</button>' +
        '</div>';
      overlayEl.classList.add('visible');

      var phaseEl = document.getElementById('calPhase');
      var samplesEl = document.getElementById('calSamples');
      var target = document.getElementById('calTarget');
      var cancelBtn = document.getElementById('calCancel');

      return new Promise(function (resolve) {
        var done = false;

        function cleanup() {
          target.removeEventListener('click', onConfirm);
          cancelBtn.removeEventListener('click', onCancel);
          global.removeEventListener('keydown', onKey);
        }

        function finishPoint(samples) {
          if (done) return;
          done = true;
          cleanup();
          totalSamples += samples;
          completed += 1;
          if (onProgress) onProgress(completed, CAL_POINTS.length);
          waitMs(350).then(function () {
            resolve(showPoint(index + 1));
          });
        }

        function onConfirm(e) {
          if (e) {
            e.preventDefault();
            e.stopPropagation();
          }
          if (phaseEl) phaseEl.textContent = 'Recording… keep looking at the circle';
          if (samplesEl) samplesEl.textContent = 'Saving samples…';
          if (target) target.disabled = true;

          recordBurst(px, py, CAL_BURST_SAMPLES).then(function (n) {
            if (n === 0) {
              if (phaseEl) phaseEl.textContent = 'Could not read your eyes — face the camera and try again';
              if (samplesEl) samplesEl.textContent = 'Make sure your face is lit and visible in the preview';
              if (target) target.disabled = false;
              done = false;
              return;
            }
            if (samplesEl) samplesEl.textContent = n + ' samples saved for this point';
            finishPoint(n);
          });
        }

        function onCancel() {
          if (done) return;
          cancelled = true;
          done = true;
          cleanup();
          resolve();
        }

        function onKey(e) {
          if (e.code === 'Space' || e.key === ' ') {
            e.preventDefault();
            onConfirm();
          }
        }

        target.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
        global.addEventListener('keydown', onKey);
      });
    }
  }

  /**
   * Accuracy gate threshold (px). Override with window.SIDE_NOTE_ACCURACY_THRESHOLD_PX.
   * Default 180 — avg gaze error must be under this to start the exam.
   */
  function getPassThresholdPx() {
    var configured = global.SIDE_NOTE_ACCURACY_THRESHOLD_PX;
    if (typeof configured === 'number' && isFinite(configured) && configured > 0) {
      return configured;
    }
    return 180;
  }

  function warmupAfterCalibration(ms) {
    ms = ms || 3000;
    resetSmoothing();
    return new Promise(function (resolve) {
      var waited = 0;
      var tick = global.setInterval(function () {
        readPrediction();
        waited += 200;
        if (waited >= ms) {
          global.clearInterval(tick);
          resolve();
        }
      }, 200);
    });
  }

  function runValidation(overlayEl) {
    var testPoints = CAL_POINTS.slice();
    var errors = [];
    var passThreshold = getPassThresholdPx();
    state.validating = true;

    function sampleAtPoint(index) {
      if (index >= testPoints.length) return Promise.resolve();

      var nx = testPoints[index][0];
      var ny = testPoints[index][1];
      var px = nx * global.innerWidth;
      var py = ny * global.innerHeight;

      overlayEl.innerHTML =
        '<div class="cal-backdrop validation-mode">' +
          '<div class="cal-instructions">' +
            '<h2>Check ' + (index + 1) + ' / ' + testPoints.length + '</h2>' +
            '<p>Look at the <strong>green dot</strong> (don\'t click).</p>' +
            '<p id="valPhase" class="cal-tip">Move your eyes to the dot…</p>' +
            '<p id="valLive" class="cal-tip" style="font-size:0.8rem"></p>' +
          '</div>' +
          '<div class="val-target" style="left:' + px + 'px;top:' + py + 'px;"></div>' +
          '<div id="valGazeDot" class="val-gaze-dot"></div>' +
        '</div>';
      overlayEl.classList.add('visible');

      var phaseEl = document.getElementById('valPhase');
      var liveEl = document.getElementById('valLive');
      var gazeDot = document.getElementById('valGazeDot');
      resetSmoothing();

      return waitMs(1000).then(function () {
        if (phaseEl) phaseEl.textContent = 'Hold steady — measuring…';
        var samples = [];
        var start = Date.now();
        var SAMPLE_MS = 1800;

        return new Promise(function (done) {
          var interval = global.setInterval(function () {
            var elapsed = Date.now() - start;

            readPrediction().then(function (b) {
              if (b) {
                if (gazeDot) {
                  gazeDot.style.display = 'block';
                  gazeDot.style.left = b.x + 'px';
                  gazeDot.style.top = b.y + 'px';
                }
                var err = Math.sqrt(Math.pow(b.x - px, 2) + Math.pow(b.y - py, 2));
                if (liveEl) liveEl.textContent = 'Offset: ' + Math.round(err) + ' px';
                if (elapsed > 500) {
                  var s = smoothGaze(b);
                  if (s) samples.push(s);
                }
              } else if (liveEl && elapsed > 800) {
                liveEl.textContent = 'No gaze yet — face the camera';
              }
            });

            if (elapsed > SAMPLE_MS) {
              global.clearInterval(interval);
              if (samples.length >= 2) {
                var avgX = samples.reduce(function (a, s) { return a + s.x; }, 0) / samples.length;
                var avgY = samples.reduce(function (a, s) { return a + s.y; }, 0) / samples.length;
                errors.push(Math.sqrt(Math.pow(avgX - px, 2) + Math.pow(avgY - py, 2)));
              } else {
                errors.push(null);
              }
              done();
            }
          }, 50);
        });
      }).then(function () {
        return waitMs(250).then(function () { return sampleAtPoint(index + 1); });
      });
    }

    return sampleAtPoint(0).then(function () {
      overlayEl.classList.remove('visible');
      overlayEl.innerHTML = '';
      state.validating = false;
      resetSmoothing();

      var validErrors = errors.filter(function (e) { return e != null; });
      var avg = validErrors.length
        ? validErrors.reduce(function (a, e) { return a + e; }, 0) / validErrors.length
        : null;
      var pointsUnderThreshold = validErrors.filter(function (e) { return e < passThreshold; }).length;

      return {
        errors: errors,
        avgErrorPx: avg,
        passThresholdPx: passThreshold,
        pointsMeasured: validErrors.length,
        pointsUnderThreshold: pointsUnderThreshold,
        // Hard gate: enough samples and average error at or under configured threshold
        passed: validErrors.length >= 5 && avg != null && avg <= passThreshold,
        noTracking: validErrors.length === 0
      };
    });
  }

  global.SideNoteGaze = {
    waitForWebGazer: waitForWebGazer,
    configureWebGazer: configureWebGazer,
    clearTrainingData: clearTrainingData,
    start: start,
    stop: stop,
    runCalibration: runCalibration,
    runValidation: runValidation,
    warmupAfterCalibration: warmupAfterCalibration,
    readPrediction: readPrediction,
    getPassThresholdPx: getPassThresholdPx,
    boundGaze: boundGaze,
    smoothGaze: smoothGaze,
    resetSmoothing: resetSmoothing,
    styleWebGazerPreview: styleWebGazerPreview,
    getVideoElement: getVideoElement,
    isCameraLive: isCameraLive,
    watchCamera: watchCamera,
    unwatchCamera: unwatchCamera,
    isFaceVisible: isFaceVisible,
    isActive: function () { return state.active; },
    getTrainingPointCount: function () { return state.trainingPoints; }
  };
})(window);
