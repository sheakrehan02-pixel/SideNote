/**
 * Side Note — Evidence capture from the exam webcam.
 *
 * On suspicious (and phone_risk at warning+): grab a short JPEG burst
 * (~2–3s, 3 frames) and store each as a flat report entry:
 *   { flag, t, imageDataUrl }
 *
 * Hard cap: MAX_ITEMS (8) evidence snapshots per session so base64 JPEGs
 * do not blow browser memory. When over cap, drop lowest-priority / oldest
 * and null their imageDataUrl for GC.
 *
 * API: window.SideNoteEvidence
 *   .reset()
 *   .needsCapture(status, flags) → boolean
 *   .captureForFlags(status, flags) → Promise<entry[]|null>
 *   .getItems() → evidence[]
 *   .getCount() → number
 *   .MAX_ITEMS → 8
 */
(function (global) {
  'use strict';

  /** Hard ceiling — never store more than this many snapshots per session */
  var MAX_ITEMS = 8;
  var JPEG_QUALITY = 0.65;
  var MAX_WIDTH = 280;
  /** Absolute delays from capture start — ~2s span, 3 JPEGs */
  var BURST_DELAYS_MS = [0, 900, 1800];
  var COOLDOWN_MS = 4000;

  var state = {
    items: [],
    capturing: false,
    lastCaptureKey: null,
    lastCaptureAt: 0,
    dropped: 0
  };

  function findVideo() {
    return (
      document.getElementById('webgazerVideoFeed') ||
      document.querySelector('#webgazerVideoContainer video') ||
      document.querySelector('video')
    );
  }

  function captureJpegDataUrl() {
    var video = findVideo();
    if (!video || video.readyState < 2 || !video.videoWidth) return null;

    var canvas = document.createElement('canvas');
    var srcW = video.videoWidth;
    var srcH = video.videoHeight;
    var w = Math.min(MAX_WIDTH, srcW);
    var h = Math.max(1, Math.round(srcH * (w / srcW)));
    canvas.width = w;
    canvas.height = h;

    try {
      var ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, w, h);
      return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    } catch (err) {
      return null;
    }
  }

  function priorityScore(it) {
    var s = 0;
    if (it.flag === 'phone_risk') s += 10;
    if (it.flag === 'looking_down' || it.flag === 'gaze_off_screen') s += 3;
    if (it.flag === 'face_not_visible') s += 2;
    return s;
  }

  /**
   * Keep at most MAX_ITEMS. Prefer phone_risk; among equals drop oldest.
   * Cleared imageDataUrl on discarded entries to help GC.
   */
  function enforceCap() {
    if (state.items.length <= MAX_ITEMS) return;

    var ranked = state.items.slice().sort(function (a, b) {
      var d = priorityScore(a) - priorityScore(b);
      if (d !== 0) return d;
      return String(a.t).localeCompare(String(b.t));
    });

    while (ranked.length > MAX_ITEMS) {
      var dropped = ranked.shift();
      if (dropped) {
        dropped.imageDataUrl = null;
        state.dropped += 1;
      }
    }

    ranked.sort(function (a, b) {
      return String(a.t).localeCompare(String(b.t));
    });
    state.items = ranked;
  }

  function pushEntry(entry) {
    state.items.push(entry);
    enforceCap();
  }

  function captureBurstEntries(flag) {
    var kept = [];
    return BURST_DELAYS_MS.reduce(function (chain, delay, index) {
      return chain.then(function () {
        var wait = index === 0 ? 0 : delay - BURST_DELAYS_MS[index - 1];
        return new Promise(function (resolve) {
          global.setTimeout(function () {
            var imageDataUrl = captureJpegDataUrl();
            if (imageDataUrl) {
              var entry = {
                flag: flag,
                t: new Date().toISOString(),
                imageDataUrl: imageDataUrl
              };
              pushEntry(entry);
              // Only report entries that survived the cap
              if (state.items.indexOf(entry) >= 0) kept.push(entry);
            }
            resolve();
          }, wait);
        });
      });
    }, Promise.resolve()).then(function () {
      return kept;
    });
  }

  function needsCapture(status, flags) {
    flags = flags || [];
    if (status === 'suspicious') return true;
    return flags.some(function (f) {
      return f.id === 'phone_risk' && (f.severity === 'warning' || f.severity === 'suspicious');
    });
  }

  function captureKey(status, flags) {
    var top = (flags && flags[0]) || null;
    if (top) return top.id + ':' + top.severity;
    return status || 'unknown';
  }

  function reset() {
    // Drop large strings before clearing the array
    state.items.forEach(function (it) {
      if (it) it.imageDataUrl = null;
    });
    state.items = [];
    state.capturing = false;
    state.lastCaptureKey = null;
    state.lastCaptureAt = 0;
    state.dropped = 0;
  }

  /** Flat list for session report: [{ flag, t, imageDataUrl }, ...] — length ≤ MAX_ITEMS */
  function getItems() {
    enforceCap();
    return state.items.map(function (it) {
      return {
        flag: it.flag,
        t: it.t,
        imageDataUrl: it.imageDataUrl
      };
    });
  }

  function getCount() {
    return state.items.length;
  }

  function isCapturing() {
    return !!state.capturing;
  }

  /** Resolve when no burst is in flight (or after timeoutMs). */
  function whenIdle(timeoutMs) {
    timeoutMs = timeoutMs || 2500;
    if (!state.capturing) return Promise.resolve(true);
    var started = Date.now();
    return new Promise(function (resolve) {
      (function poll() {
        if (!state.capturing || Date.now() - started > timeoutMs) {
          resolve(!state.capturing);
          return;
        }
        global.setTimeout(poll, 100);
      })();
    });
  }

  /**
   * Capture a 2–3s JPEG burst and append flat evidence entries (capped).
   */
  function captureForFlags(status, flags) {
    if (!needsCapture(status, flags)) return Promise.resolve(null);

    var key = captureKey(status, flags);
    var now = Date.now();
    if (state.capturing) return Promise.resolve(null);
    if (key === state.lastCaptureKey && (now - state.lastCaptureAt) < COOLDOWN_MS) {
      return Promise.resolve(null);
    }

    var top = (flags && flags[0]) || null;
    var flag = top ? top.id : (status === 'suspicious' ? 'suspicious' : 'unknown');

    state.capturing = true;
    state.lastCaptureKey = key;
    state.lastCaptureAt = now;

    return captureBurstEntries(flag)
      .then(function (entries) {
        enforceCap();
        if (!entries || !entries.length) return null;
        return entries.filter(function (e) {
          return state.items.indexOf(e) >= 0;
        });
      })
      .catch(function () {
        return null;
      })
      .then(function (entries) {
        state.capturing = false;
        if (entries && entries.length && typeof console !== 'undefined' && console.log) {
          console.log('[SideNote evidence cap]', {
            stored: state.items.length,
            max: MAX_ITEMS,
            droppedTotal: state.dropped
          });
        }
        return entries && entries.length ? entries : null;
      });
  }

  global.SideNoteEvidence = {
    reset: reset,
    needsCapture: needsCapture,
    captureForFlags: captureForFlags,
    getItems: getItems,
    getCount: getCount,
    isCapturing: isCapturing,
    whenIdle: whenIdle,
    MAX_ITEMS: MAX_ITEMS
  };
})(window);
