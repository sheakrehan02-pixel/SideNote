/**
 * Side Note — MediaPipe Face Mesh wrapper.
 *
 * Exposes face presence + rough head pitch/yaw for the cheating detector.
 * Uses the WebGazer video element when available (no second camera stream).
 *
 * API: window.SideNoteFace
 *   .waitForReady() → Promise
 *   .start(videoEl?) → Promise
 *   .stop()
 *   .isFaceVisible(maxAgeMs?) → boolean
 *   .getHeadPose() → { pitch, yaw, roll } | null
 *   .getFacesCount() → number
 *   .getLastLandmarks() → landmarks[] | null
 *   .isReady() → boolean
 *
 * Pitch/yaw are unitless rough estimates (~-0.5…0.5), not degrees:
 *   pitch > 0 → face angled down (chin toward chest)
 *   yaw   > 0 → face turned toward image +x (depends on mirrored preview)
 */
(function (global) {
  'use strict';

  var DEFAULT_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/';
  var FRAME_GAP_MS = 66; // ~15 Hz — enough for presence/pose, lighter on CPU

  // MediaPipe Face Mesh landmark indices
  var IDX = {
    nose: 1,
    chin: 152,
    forehead: 10,
    leftEyeOuter: 33,
    rightEyeOuter: 263,
    leftCheek: 234,
    rightCheek: 454
  };

  var state = {
    faceMesh: null,
    ready: false,
    active: false,
    video: null,
    rafId: null,
    lastSendMs: 0,
    lastFaceTime: 0,
    facesCount: 0,
    headPose: null,
    landmarks: null,
    initPromise: null,
    busy: false
  };

  function cdnBase() {
    var base = global.SIDE_NOTE_FACE_MESH_CDN || DEFAULT_CDN;
    return base.charAt(base.length - 1) === '/' ? base : base + '/';
  }

  function hasFaceMeshCtor() {
    return typeof global.FaceMesh === 'function';
  }

  function findVideoElement(preferred) {
    if (preferred && preferred.tagName === 'VIDEO') return preferred;
    if (global.SideNoteGaze && typeof global.SideNoteGaze.getVideoElement === 'function') {
      var fromGaze = global.SideNoteGaze.getVideoElement();
      if (fromGaze) return fromGaze;
    }
    return (
      document.getElementById('webgazerVideoFeed') ||
      document.querySelector('#webgazerVideoContainer video') ||
      document.querySelector('video')
    );
  }

  /** WebGazer mounts video asynchronously after begin() — wait briefly. */
  function waitForVideoElement(preferred, timeoutMs) {
    timeoutMs = timeoutMs || 8000;
    return new Promise(function (resolve, reject) {
      var started = Date.now();
      function tick() {
        var video = findVideoElement(preferred);
        if (video) {
          resolve(video);
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          reject(new Error('No video element found for Face Mesh'));
          return;
        }
        global.setTimeout(tick, 200);
      }
      tick();
    });
  }

  function estimateHeadPose(landmarks) {
    if (!landmarks || landmarks.length < 455) return null;

    var nose = landmarks[IDX.nose];
    var chin = landmarks[IDX.chin];
    var forehead = landmarks[IDX.forehead];
    var leftEye = landmarks[IDX.leftEyeOuter];
    var rightEye = landmarks[IDX.rightEyeOuter];
    var leftCheek = landmarks[IDX.leftCheek];
    var rightCheek = landmarks[IDX.rightCheek];
    if (!nose || !chin || !forehead || !leftEye || !rightEye) return null;

    var eyeMidX = (leftEye.x + rightEye.x) / 2;
    var eyeMidY = (leftEye.y + rightEye.y) / 2;

    var faceWidth = Math.abs((rightCheek && rightCheek.x) - (leftCheek && leftCheek.x));
    if (!faceWidth || faceWidth < 0.01) {
      faceWidth = Math.abs(rightEye.x - leftEye.x) || 0.01;
    }
    var faceHeight = Math.abs(chin.y - forehead.y) || 0.01;

    // Rough yaw: nose offset from eye midline, normalized by face width
    var yaw = (nose.x - eyeMidX) / faceWidth;

    // Rough pitch: where nose sits between forehead and chin (0.45 ≈ neutral)
    var noseAlong = (nose.y - forehead.y) / faceHeight;
    var pitch = noseAlong - 0.45;

    // Rough roll: eye line tilt
    var roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);

    return {
      pitch: Math.round(pitch * 1000) / 1000,
      yaw: Math.round(yaw * 1000) / 1000,
      roll: Math.round(roll * 1000) / 1000
    };
  }

  function onResults(results) {
    var faces = results && results.multiFaceLandmarks ? results.multiFaceLandmarks : [];
    state.facesCount = faces.length;

    if (faces.length > 0) {
      state.lastFaceTime = Date.now();
      state.landmarks = faces[0];
      state.headPose = estimateHeadPose(faces[0]);
    } else {
      state.landmarks = null;
      state.headPose = null;
    }
  }

  function waitForReady(timeoutMs) {
    timeoutMs = timeoutMs || 15000;
    if (state.ready && state.faceMesh) return Promise.resolve(true);
    if (hasFaceMeshCtor() && !state.initPromise) return init();

    return new Promise(function (resolve, reject) {
      var started = Date.now();
      (function poll() {
        if (hasFaceMeshCtor()) {
          init().then(resolve).catch(reject);
          return;
        }
        if (global._faceMeshSource === 'none') {
          reject(new Error('MediaPipe Face Mesh failed to load'));
          return;
        }
        if (Date.now() - started > timeoutMs) {
          reject(new Error('Timed out waiting for MediaPipe Face Mesh'));
          return;
        }
        global.setTimeout(poll, 100);
      })();
    });
  }

  function init() {
    if (state.initPromise) return state.initPromise;
    if (!hasFaceMeshCtor()) {
      return Promise.reject(new Error('FaceMesh constructor not available'));
    }

    state.initPromise = new Promise(function (resolve, reject) {
      try {
        var faceMesh = new global.FaceMesh({
          locateFile: function (file) {
            return cdnBase() + file;
          }
        });

        faceMesh.setOptions({
          maxNumFaces: 2,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
        faceMesh.onResults(onResults);

        state.faceMesh = faceMesh;
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
      state.faceMesh &&
      video &&
      video.readyState >= 2 &&
      now - state.lastSendMs >= FRAME_GAP_MS
    ) {
      state.lastSendMs = now;
      state.busy = true;
      state.faceMesh
        .send({ image: video })
        .catch(function () { /* drop frame on transient errors */ })
        .then(function () {
          state.busy = false;
        });
    }

    state.rafId = global.requestAnimationFrame(tick);
  }

  function start(videoEl) {
    return waitForReady().then(function () {
      return waitForVideoElement(videoEl, 8000);
    }).then(function (video) {
      state.video = video;
      state.active = true;
      state.lastSendMs = 0;

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
  }

  function isFaceVisible(maxAgeMs) {
    maxAgeMs = maxAgeMs || 800;
    return state.lastFaceTime > 0 && (Date.now() - state.lastFaceTime) < maxAgeMs;
  }

  function getHeadPose() {
    return state.headPose ? {
      pitch: state.headPose.pitch,
      yaw: state.headPose.yaw,
      roll: state.headPose.roll
    } : null;
  }

  function getFacesCount() {
    return state.facesCount;
  }

  function getLastLandmarks() {
    return state.landmarks;
  }

  function isReady() {
    return !!(state.ready && state.faceMesh);
  }

  global.SideNoteFace = {
    waitForReady: waitForReady,
    init: init,
    start: start,
    stop: stop,
    isFaceVisible: isFaceVisible,
    getHeadPose: getHeadPose,
    getFacesCount: getFacesCount,
    getLastLandmarks: getLastLandmarks,
    isReady: isReady
  };
})(window);
