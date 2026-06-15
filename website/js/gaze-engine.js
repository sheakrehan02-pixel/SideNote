/**
 * Side Note — WebGazer wrapper with smoothing, calibration, and validation.
 */
(function (global) {
  'use strict';

  var SMOOTH_ALPHA = 0.35;
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
    rafId: null
  };

  function hasWebGazer() {
    return typeof global.webgazer !== 'undefined';
  }

  function boundGaze(raw) {
    if (!raw || typeof raw.x !== 'number' || typeof raw.y !== 'number') return null;
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

  /**
   * WebGazer getCurrentPrediction() is async (returns a Promise) in current builds.
   */
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
          if (b) state.latestGaze = b;
          return b || state.latestGaze;
        }).catch(function () {
          return state.latestGaze;
        });
      }
      var b = boundGaze(result);
      if (b) state.latestGaze = b;
      return Promise.resolve(b || state.latestGaze);
    } catch (e) {
      return Promise.resolve(state.latestGaze);
    }
  }

  function onGazeData(data) {
    if (!state.active) return;
    var b = boundGaze(data);
    if (b) state.latestGaze = b;
    if (state.calibrating) return;
    var s = smoothGaze(data);
    if (s && state.listener) state.listener(s);
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
      el.style.setProperty('border', '2px solid rgba(0,212,170,0.4)', 'important');
      el.style.setProperty('z-index', '9990', 'important');
      el.style.setProperty('opacity', '0.85', 'important');
    });
  }

  function configureWebGazer() {
    var wg = global.webgazer;
    if (!wg) return;

    if (typeof wg.setRegression === 'function') {
      try { wg.setRegression('ridge'); } catch (e) {}
    }
    if (typeof wg.setTracker === 'function') {
      try { wg.setTracker('TFFacemesh'); } catch (e) {}
    }
    if (wg.params) {
      wg.params.showVideo = true;
      wg.params.showFaceOverlay = true;
      wg.params.showFaceFeedbackBox = true;
    }
    if (typeof wg.showPredictionPoints === 'function') wg.showPredictionPoints(true);
    if (typeof wg.showVideo === 'function') wg.showVideo(true);
    else if (typeof wg.showVideoPreview === 'function') wg.showVideoPreview(true);

    global.setTimeout(styleWebGazerPreview, 500);
    global.setTimeout(styleWebGazerPreview, 2000);
  }

  function clearTrainingData() {
    var wg = global.webgazer;
    if (!wg) return Promise.resolve();
    state.latestGaze = null;
    resetSmoothing();
    if (typeof wg.clearData === 'function') {
      return Promise.resolve(wg.clearData());
    }
    if (typeof wg.clearStoredData === 'function') {
      wg.clearStoredData();
    }
    return Promise.resolve();
  }

  function waitForWebGazer(maxAttempts, intervalMs) {
    maxAttempts = maxAttempts || 60;
    intervalMs = intervalMs || 200;
    return new Promise(function (resolve, reject) {
      var attempts = 0;
      function tick() {
        if (hasWebGazer()) return resolve(global.webgazer);
        attempts += 1;
        if (attempts >= maxAttempts) {
          return reject(new Error('WebGazer failed to load. Use http://localhost:8000/demo.html'));
        }
        global.setTimeout(tick, intervalMs);
      }
      tick();
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
      else wg.begin();

      function loop() {
        if (!state.active) return;
        readPrediction().then(function (b) {
          if (!b || state.calibrating || !state.listener) return;
          var s = smoothGaze(b);
          if (s) state.listener(s);
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
  }

  function enableMouseCalibration() {
    if (hasWebGazer() && typeof global.webgazer.addMouseEventListeners === 'function') {
      global.webgazer.addMouseEventListeners();
    }
  }

  function disableMouseCalibration() {
    if (hasWebGazer() && typeof global.webgazer.removeMouseEventListeners === 'function') {
      global.webgazer.removeMouseEventListeners();
    }
  }

  function runCalibration(overlayEl, onProgress) {
    if (!overlayEl) return Promise.reject(new Error('Calibration overlay missing'));

    state.calibrating = true;
    var completed = 0;
    var cancelled = false;

    return clearTrainingData().then(function () {
      enableMouseCalibration();
      return showPoint(0);
    }).then(function () {
      overlayEl.classList.remove('visible');
      overlayEl.innerHTML = '';
      disableMouseCalibration();
      state.calibrating = false;
      resetSmoothing();
      return { pointsCompleted: completed, cancelled: cancelled };
    });

    function showPoint(index) {
      return new Promise(function (resolve) {
        if (cancelled || index >= CAL_POINTS.length) return resolve();

        var nx = CAL_POINTS[index][0];
        var ny = CAL_POINTS[index][1];
        var px = nx * global.innerWidth;
        var py = ny * global.innerHeight;

        overlayEl.innerHTML =
          '<div class="cal-backdrop">' +
            '<div class="cal-instructions">' +
              '<h2>Calibration ' + (index + 1) + ' / ' + CAL_POINTS.length + '</h2>' +
              '<p>Keep your head still. <strong>Look at the circle</strong>, then <strong>click it</strong>.</p>' +
              '<p class="cal-tip">Face the camera. Good lighting on your face helps a lot.</p>' +
            '</div>' +
            '<button type="button" class="cal-target" id="calTarget" style="left:' + px + 'px;top:' + py + 'px;">' +
              '<span class="cal-target-ring"></span>' +
              '<span class="cal-target-core"></span>' +
            '</button>' +
            '<button type="button" class="btn btn-secondary cal-skip" id="calCancel">Cancel</button>' +
          '</div>';
        overlayEl.classList.add('visible');

        var target = document.getElementById('calTarget');
        var cancelBtn = document.getElementById('calCancel');

        function advance() {
          completed += 1;
          if (onProgress) onProgress(completed, CAL_POINTS.length);
          target.removeEventListener('click', advance);
          cancelBtn.removeEventListener('click', onCancel);
          global.setTimeout(function () { resolve(showPoint(index + 1)); }, 300);
        }

        function onCancel() {
          cancelled = true;
          target.removeEventListener('click', advance);
          cancelBtn.removeEventListener('click', onCancel);
          resolve();
        }

        target.addEventListener('click', advance);
        cancelBtn.addEventListener('click', onCancel);
      });
    }
  }

  function getPassThresholdPx() {
    var d = Math.sqrt(global.innerWidth * global.innerWidth + global.innerHeight * global.innerHeight);
    return Math.max(280, Math.min(500, d * 0.22));
  }

  function warmupAfterCalibration(ms) {
    ms = ms || 2500;
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
    var testPoints = [CAL_POINTS[0], CAL_POINTS[2], CAL_POINTS[4], CAL_POINTS[6], CAL_POINTS[8]];
    var errors = [];
    var passThreshold = getPassThresholdPx();
    state.validating = true;

    function waitMs(ms) {
      return new Promise(function (resolve) { global.setTimeout(resolve, ms); });
    }

    function sampleAtPoint(index) {
      if (index >= testPoints.length) return Promise.resolve();

      var nx = testPoints[index][0];
      var ny = testPoints[index][1];
      var px = nx * global.innerWidth;
      var py = ny * global.innerHeight;

      overlayEl.innerHTML =
        '<div class="cal-backdrop validation-mode">' +
          '<div class="cal-instructions">' +
            '<h2>Accuracy check ' + (index + 1) + ' / ' + testPoints.length + '</h2>' +
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

      return waitMs(1200).then(function () {
        if (phaseEl) phaseEl.textContent = 'Hold steady — measuring…';
        var samples = [];
        var start = Date.now();
        var SAMPLE_MS = 2000;

        return new Promise(function (done) {
          var interval = global.setInterval(function () {
            readPrediction().then(function (b) {
              if (!b) return;
              if (gazeDot) {
                gazeDot.style.display = 'block';
                gazeDot.style.left = b.x + 'px';
                gazeDot.style.top = b.y + 'px';
              }
              if (liveEl) liveEl.textContent = 'Tracker: ' + Math.round(b.x) + ', ' + Math.round(b.y);

              var elapsed = Date.now() - start;
              if (elapsed > 400) {
                var s = smoothGaze(b);
                if (s) samples.push(s);
              }
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
            });
          }, 50);
        });
      }).then(function () {
        return waitMs(300).then(function () { return sampleAtPoint(index + 1); });
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
        passed: validErrors.length >= 2 && (avg < passThreshold || pointsUnderThreshold >= 2),
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
    isActive: function () { return state.active; }
  };
})(window);
