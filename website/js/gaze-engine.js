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
    smoothX: null,
    smoothY: null,
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
      try { wg.setRegression('weightedRidge'); } catch (e) {
        try { wg.setRegression('ridge'); } catch (e2) {}
      }
    }
    if (typeof wg.setTracker === 'function') {
      try { wg.setTracker('TFFacemesh'); } catch (e) {}
    }
    if (wg.params) {
      wg.params.showVideo = true;
      wg.params.showFaceOverlay = true;
      wg.params.showFaceFeedbackBox = true;
    }
    if (typeof wg.showPredictionPoints === 'function') wg.showPredictionPoints(false);
    if (typeof wg.showVideo === 'function') wg.showVideo(true);
    else if (typeof wg.showVideoPreview === 'function') wg.showVideoPreview(true);

    global.setTimeout(styleWebGazerPreview, 500);
    global.setTimeout(styleWebGazerPreview, 2000);
  }

  function clearTrainingData() {
    var wg = global.webgazer;
    if (!wg) return;
    if (typeof wg.clearData === 'function') wg.clearData();
    else if (typeof wg.clearStoredData === 'function') wg.clearStoredData();
  }

  function waitForWebGazer(maxAttempts, intervalMs) {
    maxAttempts = maxAttempts || 60;
    intervalMs = intervalMs || 200;
    return new Promise(function (resolve, reject) {
      var attempts = 0;
      function tick() {
        if (hasWebGazer()) return resolve(global.webgazer);
        attempts += 1;
        if (attempts >= maxAttempts) return reject(new Error('WebGazer failed to load. Use http://localhost:8000/demo.html over HTTPS or localhost.'));
        global.setTimeout(tick, intervalMs);
      }
      tick();
    });
  }

  function start(onGaze) {
    if (state.active) return Promise.resolve();
    return waitForWebGazer().then(function () {
      configureWebGazer();
      state.listener = onGaze || null;
      state.active = true;
      resetSmoothing();

      var wg = global.webgazer;
      var chain = wg.setGazeListener(function (data) {
        if (!state.active || state.calibrating) return;
        var s = smoothGaze(data);
        if (s && state.listener) state.listener(s);
      });
      if (chain && typeof chain.begin === 'function') chain.begin();
      else wg.begin();

      function loop() {
        if (!state.active) return;
        if (typeof wg.getCurrentPrediction === 'function') {
          var p = wg.getCurrentPrediction();
          var s = smoothGaze(p);
          if (s && state.listener) state.listener(s);
        }
        state.rafId = global.requestAnimationFrame(loop);
      }
      state.rafId = global.requestAnimationFrame(loop);
    });
  }

  function stop() {
    state.active = false;
    if (state.rafId != null) {
      global.cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
    try {
      if (hasWebGazer()) global.webgazer.end();
    } catch (e) {}
    resetSmoothing();
  }

  function pause() {
    if (hasWebGazer() && typeof global.webgazer.pause === 'function') global.webgazer.pause();
  }

  function resume() {
    if (hasWebGazer() && typeof global.webgazer.resume === 'function') global.webgazer.resume();
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

  /**
   * Guided 9-point calibration. User looks at each dot and clicks it.
   * Returns { pointsCompleted, cancelled }.
   */
  function runCalibration(overlayEl, onProgress) {
    if (!overlayEl) return Promise.reject(new Error('Calibration overlay missing'));

    state.calibrating = true;
    clearTrainingData();
    enableMouseCalibration();

    var completed = 0;
    var cancelled = false;

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
            '<button type="button" class="cal-target" id="calTarget" style="left:' + px + 'px;top:' + py + 'px;" aria-label="Calibration point ' + (index + 1) + '">' +
              '<span class="cal-target-ring"></span>' +
              '<span class="cal-target-core"></span>' +
            '</button>' +
            '<button type="button" class="btn btn-secondary cal-skip" id="calCancel">Cancel calibration</button>' +
          '</div>';

        overlayEl.classList.add('visible');

        var target = document.getElementById('calTarget');
        var cancelBtn = document.getElementById('calCancel');
        var hitRadius = 80;

        function advance(ev) {
          var cx = px;
          var cy = py;
          if (ev) {
            cx = ev.clientX;
            cy = ev.clientY;
          }
          var dx = cx - px;
          var dy = cy - py;
          if (Math.sqrt(dx * dx + dy * dy) > hitRadius && ev) return;

          completed += 1;
          if (onProgress) onProgress(completed, CAL_POINTS.length);
          target.removeEventListener('click', advance);
          cancelBtn.removeEventListener('click', onCancel);
          global.setTimeout(function () { resolve(showPoint(index + 1)); }, 350);
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

    return showPoint(0).then(function () {
      overlayEl.classList.remove('visible');
      overlayEl.innerHTML = '';
      disableMouseCalibration();
      state.calibrating = false;
      resetSmoothing();
      return { pointsCompleted: completed, cancelled: cancelled };
    });
  }

  /**
   * Accuracy check: show a dot, sample gaze for ~1.2s, measure pixel error.
   */
  function runValidation(overlayEl) {
    var testPoints = [
      [0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]
    ];
    var errors = [];

    function sampleAtPoint(index) {
      return new Promise(function (resolve) {
        if (index >= testPoints.length) return resolve();

        var nx = testPoints[index][0];
        var ny = testPoints[index][1];
        var px = nx * global.innerWidth;
        var py = ny * global.innerHeight;

        overlayEl.innerHTML =
          '<div class="cal-backdrop validation-mode">' +
            '<div class="cal-instructions">' +
              '<h2>Accuracy check ' + (index + 1) + ' / ' + testPoints.length + '</h2>' +
              '<p>Look at the <strong>green dot</strong> — do not click. Hold your gaze steady.</p>' +
            '</div>' +
            '<div class="val-target" style="left:' + px + 'px;top:' + py + 'px;"></div>' +
          '</div>';
        overlayEl.classList.add('visible');

        var samples = [];
        var start = Date.now();
        var interval = global.setInterval(function () {
          if (!hasWebGazer()) return;
          var p = global.webgazer.getCurrentPrediction();
          var b = boundGaze(p);
          if (b) samples.push(b);
          if (Date.now() - start > 1200) {
            global.clearInterval(interval);
            if (samples.length) {
              var avgX = samples.reduce(function (a, s) { return a + s.x; }, 0) / samples.length;
              var avgY = samples.reduce(function (a, s) { return a + s.y; }, 0) / samples.length;
              var err = Math.sqrt(Math.pow(avgX - px, 2) + Math.pow(avgY - py, 2));
              errors.push(err);
            }
            global.setTimeout(function () { resolve(sampleAtPoint(index + 1)); }, 300);
          }
        }, 50);
      });
    }

    return sampleAtPoint(0).then(function () {
      overlayEl.classList.remove('visible');
      overlayEl.innerHTML = '';
      var avg = errors.length ? errors.reduce(function (a, e) { return a + e; }, 0) / errors.length : 999;
      return { errors: errors, avgErrorPx: avg, passed: avg < 180 };
    });
  }

  global.SideNoteGaze = {
    waitForWebGazer: waitForWebGazer,
    configureWebGazer: configureWebGazer,
    clearTrainingData: clearTrainingData,
    start: start,
    stop: stop,
    pause: pause,
    resume: resume,
    runCalibration: runCalibration,
    runValidation: runValidation,
    boundGaze: boundGaze,
    smoothGaze: smoothGaze,
    resetSmoothing: resetSmoothing,
    styleWebGazerPreview: styleWebGazerPreview,
    isActive: function () { return state.active; }
  };
})(window);
