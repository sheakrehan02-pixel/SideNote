/**
 * Side Note — WebGazer wrapper with gaze-only calibration, smoothing, validation.
 *
 * How it works:
 *  1. WebGazer (TFFacemesh) extracts eye features from webcam each frame.
 *  2. weightedRidge regression maps eye features → screen (x, y).
 *  3. User calibrates by LOOKING at each dot (no clicking) — we call
 *     recordScreenPosition() while they fixate, building training pairs.
 *  4. Kalman filter + light EMA smooth the output for the proctoring loop.
 */
(function (global) {
  'use strict';

  var SMOOTH_ALPHA = 0.25;
  var CAL_SAMPLES_PER_POINT = 5;
  var CAL_SAMPLE_INTERVAL_MS = 150;
  var CAL_SETTLE_MS = 1000;
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
    maxAgeMs = maxAgeMs || 800;
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
    if (!hasWebGazer()) return Promise.resolve(state.latestGaze);

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

  function setWebGazerDebug(show) {
    if (!hasWebGazer()) return;
    var wg = global.webgazer;
    if (typeof wg.showPredictionPoints === 'function') wg.showPredictionPoints(!!show);
    if (wg.params) wg.params.showGazeDot = !!show;
  }

  function configureWebGazer() {
    var wg = global.webgazer;
    if (!wg) return;

    if (typeof wg.setRegression === 'function') {
      try { wg.setRegression('weightedRidge'); } catch (e1) {
        try { wg.setRegression('ridge'); } catch (e2) {}
      }
    }
    if (typeof wg.setTracker === 'function') {
      try { wg.setTracker('TFFacemesh'); } catch (e) {}
    }
    if (typeof wg.applyKalmanFilter === 'function') {
      try { wg.applyKalmanFilter(true); } catch (e) {}
    }
    if (wg.params) {
      wg.params.showVideo = true;
      wg.params.showFaceOverlay = false;
      wg.params.showFaceFeedbackBox = true;
      wg.params.showGazeDot = false;
      wg.params.moveTickSize = 50;
    }
    setWebGazerDebug(false);
    if (typeof wg.showVideo === 'function') wg.showVideo(true);
    else if (typeof wg.showVideoPreview === 'function') wg.showVideoPreview(true);

    global.setTimeout(styleWebGazerPreview, 500);
    global.setTimeout(styleWebGazerPreview, 2000);
  }

  function recordTrainingPoint(px, py) {
    if (!hasWebGazer()) return false;
    var wg = global.webgazer;
    if (typeof wg.recordScreenPosition !== 'function') return false;
    try {
      wg.recordScreenPosition(px, py, 'click');
      state.trainingPoints += 1;
      return true;
    } catch (e) {
      return false;
    }
  }

  function clearTrainingData() {
    var wg = global.webgazer;
    if (!wg) return Promise.resolve();
    state.latestGaze = null;
    state.trainingPoints = 0;
    state.lastFaceTime = 0;
    resetSmoothing();
    if (typeof wg.clearData === 'function') {
      return Promise.resolve(wg.clearData());
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

  function waitForFace(timeoutMs) {
    timeoutMs = timeoutMs || 5000;
    return new Promise(function (resolve) {
      var waited = 0;
      var tick = global.setInterval(function () {
        readPrediction().then(function (p) {
          if (p) {
            global.clearInterval(tick);
            resolve(true);
          }
        });
        waited += 200;
        if (waited >= timeoutMs) {
          global.clearInterval(tick);
          resolve(isFaceVisible(200));
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
      state.active = true;
      resetSmoothing();

      var wg = global.webgazer;
      var chain = wg.setGazeListener(onGazeData);
      if (chain && typeof chain.begin === 'function') chain.begin();
      else if (typeof wg.begin === 'function') wg.begin();

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
  }

  function waitMs(ms) {
    return new Promise(function (resolve) { global.setTimeout(resolve, ms); });
  }

  /**
   * Gaze-only calibration: user LOOKS at each dot; we sample training pairs.
   * No clicking — avoids head/hand movement that ruins accuracy.
   */
  function runCalibration(overlayEl, onProgress) {
    if (!overlayEl) return Promise.reject(new Error('Calibration overlay missing'));

    state.calibrating = true;
    var completed = 0;
    var cancelled = false;
    var totalSamples = 0;

    return clearTrainingData().then(function () {
      setWebGazerDebug(false);
      return waitForFace(6000);
    }).then(function (faceOk) {
      if (!faceOk) {
        throw new Error('Cannot see your face yet. Check lighting and camera angle, then try again.');
      }
      return calibratePoint(0);
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

    function calibratePoint(index) {
      if (cancelled || index >= CAL_POINTS.length) return Promise.resolve();

      var nx = CAL_POINTS[index][0];
      var ny = CAL_POINTS[index][1];
      var px = nx * global.innerWidth;
      var py = ny * global.innerHeight;

      overlayEl.innerHTML =
        '<div class="cal-backdrop">' +
          '<div class="cal-instructions">' +
            '<h2>Point ' + (index + 1) + ' of ' + CAL_POINTS.length + '</h2>' +
            '<p><strong>Look at the circle</strong> — keep your head still, move only your eyes.</p>' +
            '<p id="calPhase" class="cal-tip">Move your eyes to the circle…</p>' +
            '<p id="calSamples" class="cal-tip" style="font-size:0.8rem"></p>' +
          '</div>' +
          '<div class="cal-target-static" style="left:' + px + 'px;top:' + py + 'px;">' +
            '<span class="cal-target-ring"></span>' +
            '<span class="cal-target-core"></span>' +
          '</div>' +
          '<button type="button" class="btn btn-secondary cal-skip" id="calCancel">Cancel</button>' +
        '</div>';
      overlayEl.classList.add('visible');

      var phaseEl = document.getElementById('calPhase');
      var samplesEl = document.getElementById('calSamples');
      var cancelBtn = document.getElementById('calCancel');

      return new Promise(function (resolve) {
        var localCancelled = false;
        cancelBtn.addEventListener('click', function onCancel() {
          cancelled = true;
          localCancelled = true;
          resolve();
        });

        waitMs(CAL_SETTLE_MS).then(function () {
          if (localCancelled) return;
          if (phaseEl) phaseEl.textContent = 'Hold your gaze on the circle…';

          var collected = 0;
          var attempts = 0;
          var maxAttempts = Math.ceil(CAL_SAMPLES_PER_POINT * 2.5);

          return new Promise(function (doneSample) {
            var interval = global.setInterval(function () {
              if (localCancelled) {
                global.clearInterval(interval);
                return doneSample();
              }
              attempts += 1;
              readPrediction().then(function (p) {
                if (p && recordTrainingPoint(px, py)) {
                  collected += 1;
                  totalSamples += 1;
                  if (samplesEl) samplesEl.textContent = 'Samples: ' + collected + ' / ' + CAL_SAMPLES_PER_POINT;
                  if (onProgress) onProgress(completed, CAL_POINTS.length, collected, CAL_SAMPLES_PER_POINT);
                }
              });
              if (collected >= CAL_SAMPLES_PER_POINT || attempts >= maxAttempts) {
                global.clearInterval(interval);
                doneSample();
              }
            }, CAL_SAMPLE_INTERVAL_MS);
          });
        }).then(function () {
          if (localCancelled) return resolve();
          completed += 1;
          if (onProgress) onProgress(completed, CAL_POINTS.length, CAL_SAMPLES_PER_POINT, CAL_SAMPLES_PER_POINT);
          return waitMs(400).then(function () {
            resolve(calibratePoint(index + 1));
          });
        });
      });
    }
  }

  function getPassThresholdPx() {
    var d = Math.sqrt(global.innerWidth * global.innerWidth + global.innerHeight * global.innerHeight);
    return Math.max(120, Math.min(350, d * 0.12));
  }

  function warmupAfterCalibration(ms) {
    ms = ms || 4000;
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
        var noGazeCount = 0;

        return new Promise(function (done) {
          var interval = global.setInterval(function () {
            var elapsed = Date.now() - start;

            readPrediction().then(function (b) {
              if (b) {
                noGazeCount = 0;
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
              } else {
                noGazeCount += 1;
                if (liveEl && noGazeCount > 4) {
                  liveEl.textContent = 'No gaze detected — face the camera';
                }
              }
            });

            if (elapsed > SAMPLE_MS) {
              global.clearInterval(interval);
              if (samples.length >= 3) {
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
        passed: validErrors.length >= 5 && (avg < passThreshold || pointsUnderThreshold >= 5),
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
    isFaceVisible: isFaceVisible,
    isActive: function () { return state.active; },
    getTrainingPointCount: function () { return state.trainingPoints; }
  };
})(window);
