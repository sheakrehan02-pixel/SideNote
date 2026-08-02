/**
 * Side Note — MediaPipe Hands wrapper.
 *
 * Detects hands and whether they sit in the “lap” zone for phone_risk
 * co-occurrence with looking_down.
 *
 * Primary heuristic (hands_in_lap):
 *   wrist Y relative to Face Mesh chin — wrist below chin (+ face-scaled margin).
 * Fallback when face landmarks missing:
 *   absolute wrist Y > 0.55 (same idea as main.py LAP_ZONE_Y).
 *
 * API: window.SideNoteHands
 *   .waitForReady() → Promise
 *   .start(videoEl?) → Promise
 *   .stop()
 *   .getHands() → { inLap, count, inLapCount, method?, details? } | null
 *   .isReady() → boolean
 */
(function (global) {
  'use strict';

  var DEFAULT_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/';
  var FRAME_GAP_MS = 66; // ~15 Hz
  var WRIST_IDX = 0;
  var CHIN_IDX = 152;
  var FOREHEAD_IDX = 10;
  var ABS_LAP_ENTER_Y = 0.55;
  var ABS_LAP_EXIT_Y = 0.48;
  /** Enter lap when wrist is this fraction of face-height below chin */
  var REL_ENTER_FACE_FRAC = 0.18;
  /** Exit lap when wrist rises above chin + this fraction of face-height */
  var REL_EXIT_FACE_FRAC = 0.06;
  var HANDS_STALE_MS = 400;

  var state = {
    hands: null,
    ready: false,
    active: false,
    video: null,
    rafId: null,
    lastSendMs: 0,
    lastHandsTime: 0,
    lastHands: null,
    /** Per-slot hysteresis: true while that hand index is considered in-lap */
    inLapSlots: [false, false],
    initPromise: null,
    busy: false
  };

  function cdnBase() {
    var base = global.SIDE_NOTE_HANDS_CDN || DEFAULT_CDN;
    return base.charAt(base.length - 1) === '/' ? base : base + '/';
  }

  function hasHandsCtor() {
    return typeof global.Hands === 'function';
  }

  function findVideoElement(preferred) {
    if (preferred && preferred.tagName === 'VIDEO') return preferred;
    return (
      document.getElementById('webgazerVideoFeed') ||
      document.querySelector('#webgazerVideoContainer video') ||
      document.querySelector('video')
    );
  }

  /**
   * Face geometry from SideNoteFace landmarks (same camera frame).
   * @returns {{ chinY: number, faceHeight: number } | null}
   */
  function faceGeometry() {
    if (typeof global.SideNoteFace === 'undefined' || !global.SideNoteFace.getLastLandmarks) {
      return null;
    }
    if (typeof global.SideNoteFace.isFaceVisible === 'function' &&
        !global.SideNoteFace.isFaceVisible(900)) {
      return null;
    }
    var lm = global.SideNoteFace.getLastLandmarks();
    if (!lm || !lm[CHIN_IDX]) return null;

    var chinY = lm[CHIN_IDX].y;
    var foreheadY = lm[FOREHEAD_IDX] ? lm[FOREHEAD_IDX].y : chinY - 0.25;
    var faceHeight = Math.abs(chinY - foreheadY);
    if (faceHeight < 0.05) faceHeight = 0.2;

    return { chinY: chinY, faceHeight: faceHeight };
  }

  /**
   * wrist Y relative to chin → hands_in_lap (with enter/exit hysteresis).
   * Relative offset: wristRelChin = wrist.y - chin.y  (positive = below chin).
   */
  function updateHandLapSlot(slotIndex, wristY, geom) {
    var wasIn = !!state.inLapSlots[slotIndex];
    var nowIn = wasIn;
    var method;
    var wristRelChin = null;

    if (geom) {
      method = 'wrist_vs_chin';
      wristRelChin = wristY - geom.chinY;
      var enterRel = geom.faceHeight * REL_ENTER_FACE_FRAC;
      var exitRel = geom.faceHeight * REL_EXIT_FACE_FRAC;
      if (!wasIn && wristRelChin > enterRel) nowIn = true;
      else if (wasIn && wristRelChin < exitRel) nowIn = false;
    } else {
      method = 'absolute_y';
      if (!wasIn && wristY > ABS_LAP_ENTER_Y) nowIn = true;
      else if (wasIn && wristY < ABS_LAP_EXIT_Y) nowIn = false;
    }

    state.inLapSlots[slotIndex] = nowIn;
    return {
      inLap: nowIn,
      method: method,
      wristY: Math.round(wristY * 1000) / 1000,
      wristRelChin: wristRelChin == null ? null : Math.round(wristRelChin * 1000) / 1000,
      chinY: geom ? Math.round(geom.chinY * 1000) / 1000 : null
    };
  }

  function summarizeHands(multiHandLandmarks) {
    var list = multiHandLandmarks || [];
    var geom = faceGeometry();
    var inLapCount = 0;
    var details = [];
    var i;

    for (i = 0; i < 2; i++) {
      if (i >= list.length || !list[i] || !list[i][WRIST_IDX]) {
        state.inLapSlots[i] = false;
        continue;
      }
      var detail = updateHandLapSlot(i, list[i][WRIST_IDX].y, geom);
      details.push(detail);
      if (detail.inLap) inLapCount += 1;
    }

    return {
      inLap: inLapCount > 0,
      count: list.length,
      inLapCount: inLapCount,
      method: geom ? 'wrist_vs_chin' : 'absolute_y',
      details: details
    };
  }

  function onResults(results) {
    var multi = results && results.multiHandLandmarks ? results.multiHandLandmarks : [];
    state.lastHands = summarizeHands(multi);
    state.lastHandsTime = Date.now();
  }

  function waitForReady(timeoutMs) {
    timeoutMs = timeoutMs || 15000;
    if (state.ready && state.hands) return Promise.resolve(true);
    if (hasHandsCtor() && !state.initPromise) return init();

    return new Promise(function (resolve, reject) {
      var started = Date.now();
      (function poll() {
        if (hasHandsCtor()) {
          init().then(resolve).catch(reject);
          return;
        }
        if (global._handsSource === 'none') {
          reject(new Error('MediaPipe Hands failed to load'));
          return;
        }
        if (Date.now() - started > timeoutMs) {
          reject(new Error('Timed out waiting for MediaPipe Hands'));
          return;
        }
        global.setTimeout(poll, 100);
      })();
    });
  }

  function init() {
    if (state.initPromise) return state.initPromise;
    if (!hasHandsCtor()) {
      return Promise.reject(new Error('Hands constructor not available'));
    }

    state.initPromise = new Promise(function (resolve, reject) {
      try {
        var hands = new global.Hands({
          locateFile: function (file) {
            return cdnBase() + file;
          }
        });

        hands.setOptions({
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
        hands.onResults(onResults);

        state.hands = hands;
        state.ready = true;
        resolve(true);
      } catch (err) {
        state.initPromise = null;
        reject(err);
      }
    });

    return state.initPromise;
  }

  function tick() {
    if (!state.active) return;

    var now = Date.now();
    var video = state.video;

    if (
      !state.busy &&
      state.hands &&
      video &&
      video.readyState >= 2 &&
      now - state.lastSendMs >= FRAME_GAP_MS
    ) {
      state.lastSendMs = now;
      state.busy = true;
      state.hands
        .send({ image: video })
        .catch(function () { /* drop frame */ })
        .then(function () {
          state.busy = false;
        });
    }

    state.rafId = global.requestAnimationFrame(tick);
  }

  function start(videoEl) {
    return waitForReady().then(function () {
      var video = findVideoElement(videoEl);
      if (!video) {
        return Promise.reject(new Error('No video element found for Hands'));
      }

      state.video = video;
      state.active = true;
      state.lastSendMs = 0;
      state.inLapSlots = [false, false];

      if (state.rafId) {
        global.cancelAnimationFrame(state.rafId);
        state.rafId = null;
      }
      state.rafId = global.requestAnimationFrame(tick);
      return true;
    });
  }

  function stop() {
    state.active = false;
    if (state.rafId) {
      global.cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
    state.busy = false;
    state.inLapSlots = [false, false];
  }

  /**
   * Detector-facing hand signal. Fresh results only; stale → not in lap.
   * Shape: { inLap, count } — optional debug fields for console.
   */
  function getHands() {
    if (!state.ready) return null;
    if (!state.lastHandsTime || (Date.now() - state.lastHandsTime) > HANDS_STALE_MS) {
      state.inLapSlots = [false, false];
      return { inLap: false, count: 0, inLapCount: 0, method: null };
    }
    return {
      inLap: !!state.lastHands.inLap,
      count: state.lastHands.count || 0,
      inLapCount: state.lastHands.inLapCount || 0,
      method: state.lastHands.method || null,
      details: state.lastHands.details || null
    };
  }

  function isReady() {
    return !!(state.ready && state.hands);
  }

  global.SideNoteHands = {
    waitForReady: waitForReady,
    init: init,
    start: start,
    stop: stop,
    getHands: getHands,
    isReady: isReady
  };
})(window);
