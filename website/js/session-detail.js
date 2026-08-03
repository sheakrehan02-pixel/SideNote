/**
 * Side Note — Instructor session detail (session.html?id=...).
 * Shows integrity score, duration, calibration quality, flag timeline.
 */
(function () {
  'use strict';

  var FLAG_LABELS = {
    looking_down: 'Looking down (desk / lap)',
    gaze_off_screen: 'Gaze off-screen (side)',
    face_not_visible: 'Face not visible',
    hands_in_lap: 'Hands low / in lap zone',
    phone_risk: 'Possible phone / notes in lap',
    tab_blur: 'Left exam tab',
    multiple_faces: 'Multiple faces in frame'
  };

  function $(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function queryId() {
    try {
      return new URLSearchParams(window.location.search).get('id');
    } catch (e) {
      return null;
    }
  }

  function scoreTone(score) {
    if (score == null || isNaN(score)) return 'warn';
    if (score >= 80) return 'ok';
    if (score >= 60) return 'warn';
    return 'bad';
  }

  function formatDuration(seconds) {
    if (seconds == null || isNaN(seconds)) return '—';
    var s = Math.max(0, Math.round(Number(seconds)));
    var m = Math.floor(s / 60);
    var r = s % 60;
    if (m <= 0) return s + 's';
    return m + 'm ' + (r < 10 ? '0' : '') + r + 's';
  }

  function formatClock(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch (e) {
      return String(iso);
    }
  }

  function severityDisplayLabel(severity) {
    var s = String(severity || '').toLowerCase();
    if (s === 'suspicious') return 'Needs review';
    if (s === 'warning') return 'Integrity signal';
    if (s === 'info') return 'Note';
    if (s === 'ok') return 'Clear';
    return severity || 'Clear';
  }

  function flagLabel(id) {
    if (!id || id === '_untagged') return 'Untagged signal';
    return FLAG_LABELS[id] || id;
  }

  function pickEvidence(session) {
    var list = [];
    if (session.report && Array.isArray(session.report.evidence)) {
      list = session.report.evidence;
    } else if (Array.isArray(session.evidence)) {
      list = session.evidence;
    }
    return list.map(function (item) {
      if (!item || typeof item !== 'object') return null;
      var src =
        item.imageDataUrl ||
        item.image_data_url ||
        item.url ||
        item.path ||
        item.evidence_path ||
        '';
      return {
        flag: item.flag || item.flag_id || item.flagId || 'unknown',
        t: item.t || item.captured_at || item.capturedAt || null,
        imageDataUrl: src
      };
    }).filter(Boolean);
  }

  function openEvidenceLightbox(item) {
    var existing = document.getElementById('evidenceLightbox');
    if (existing) existing.remove();

    var src = item.imageDataUrl || '';
    if (!src || String(src).indexOf('[truncated') >= 0) return;

    var overlay = document.createElement('div');
    overlay.id = 'evidenceLightbox';
    overlay.className = 'evidence-lightbox';
    overlay.innerHTML =
      '<div class="evidence-lightbox-inner" role="dialog" aria-modal="true">' +
        '<img src="' + src + '" alt="' + escapeHtml(flagLabel(item.flag)) + '">' +
        '<p><span class="log-flag-id">' + escapeHtml(item.flag || '') + '</span> · ' +
          escapeHtml(flagLabel(item.flag)) + '<br>' +
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

  function renderEvidence(session) {
    var grid = $('evidenceGrid');
    var empty = $('evidenceEmpty');
    if (!grid) return;

    var evidence = pickEvidence(session);
    if (!evidence.length) {
      grid.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    grid.innerHTML = evidence.map(function (item, index) {
      var thumb = item.imageDataUrl || '';
      var when = item.t ? new Date(item.t).toLocaleTimeString() : '';
      var label = flagLabel(item.flag);
      var usable = thumb && String(thumb).indexOf('[truncated') < 0;
      if (!usable) {
        return (
          '<article class="evidence-card evidence-card--empty">' +
            '<div class="ev-meta">' +
              '<div class="ev-flag">' + escapeHtml(item.flag || 'unknown') + '</div>' +
              '<div>' + escapeHtml(label) + '</div>' +
              '<div>Frame unavailable</div>' +
            '</div>' +
          '</article>'
        );
      }
      return (
        '<article class="evidence-card">' +
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

    grid.onclick = function (ev) {
      var openBtn = ev.target.closest('[data-evidence-open]');
      if (!openBtn) return;
      var idx = parseInt(openBtn.getAttribute('data-evidence-open'), 10);
      var item = evidence[idx];
      if (!item || !item.imageDataUrl) return;
      openEvidenceLightbox(item);
    };
  }

  function pickCalibration(session) {
    if (session.calibration && typeof session.calibration === 'object') {
      return session.calibration;
    }
    if (session.report && session.report.calibration) {
      return session.report.calibration;
    }
    return null;
  }

  /**
   * Prefer DB session_events; fall back to report.events (client log) for legacy.
   */
  function buildTimeline(session) {
    var dbEvents = Array.isArray(session.events) ? session.events : [];
    if (dbEvents.length) {
      return dbEvents.map(function (e) {
        return {
          time: e.time || e.recorded_at,
          status: e.status,
          flag_id: e.flag_id,
          severity: e.severity || e.status,
          confidence: e.confidence,
          messages: e.messages || [],
          evidence_path: e.evidence_path || null
        };
      });
    }

    var reportEvents = (session.report && session.report.events) || [];
    return reportEvents.map(function (e) {
      var top = (e.flags && e.flags[0]) || null;
      return {
        time: e.time || e.started_at || null,
        status: e.status,
        flag_id: top ? top.id : (e.flag_id || null),
        severity: top ? top.severity : (e.severity || e.status),
        confidence: top && typeof top.confidence === 'number' ? top.confidence : e.confidence,
        messages: e.messages || (top && top.message ? [top.message] : []),
        evidence_path: e.evidence_path || null
      };
    }).filter(function (e) {
      return e.status && e.status !== 'ok';
    });
  }

  function renderCalibration(cal) {
    var valueEl = $('metricCal');
    var hintEl = $('metricCalHint');
    var bars = $('calBars');
    var fill = $('calBarFill');
    var thrLabel = $('calThresholdLabel');

    if (!cal) {
      valueEl.textContent = '—';
      valueEl.className = 'metric-value';
      hintEl.textContent = 'No calibration saved';
      bars.hidden = true;
      return;
    }

    var err = cal.avg_error_px;
    var passed = cal.passed === true;
    var thr = cal.pass_threshold_px != null ? Number(cal.pass_threshold_px) : 180;
    var points = cal.points != null ? cal.points : cal.points_completed;

    if (typeof err === 'number' && isFinite(err)) {
      valueEl.textContent = Math.round(err) + ' px';
      valueEl.className = 'metric-value ' + (passed ? 'pass' : 'fail');
      hintEl.textContent =
        (passed ? 'Passed' : 'Failed') +
        ' accuracy check' +
        (points != null ? ' · ' + points + ' points' : '') +
        ' · gate ≤ ' + Math.round(thr) + ' px';

      bars.hidden = false;
      thrLabel.textContent = '≤ ' + Math.round(thr) + ' px';
      // Map error onto bar: 0 → full (good), thr → ~55%, 2×thr → empty
      var ratio = 1 - Math.min(1, err / (thr * 2));
      fill.style.width = Math.max(8, Math.round(ratio * 100)) + '%';
      fill.className = 'cal-bar-fill ' + (passed ? '' : err > thr * 1.25 ? 'bad' : 'warn');
    } else {
      valueEl.textContent = passed ? 'Passed' : 'Recorded';
      valueEl.className = 'metric-value ' + (passed ? 'pass' : '');
      hintEl.textContent =
        (points != null ? points + ' calibration points' : 'Calibration present') +
        (thr ? ' · gate ≤ ' + Math.round(thr) + ' px' : '');
      bars.hidden = true;
    }
  }

  function renderTimeline(items) {
    var list = $('flagTimeline');
    var empty = $('timelineEmpty');
    list.innerHTML = '';

    if (!items.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    list.innerHTML = items.map(function (e) {
      var sev = e.severity || e.status || 'warning';
      var conf =
        typeof e.confidence === 'number'
          ? Math.round(e.confidence * 100) + '%'
          : null;
      var msg = (e.messages && e.messages.length)
        ? e.messages.join('; ')
        : '';
      return (
        '<li class="' + escapeHtml(sev) + '">' +
          '<div class="tl-time">' + escapeHtml(formatClock(e.time)) + '</div>' +
          '<div class="tl-row">' +
            '<span class="tl-flag">' + escapeHtml(flagLabel(e.flag_id)) + '</span>' +
            '<span class="tl-severity ' + escapeHtml(sev) + '">' +
              escapeHtml(severityDisplayLabel(sev)) +
            '</span>' +
            (e.flag_id
              ? '<span class="tl-conf">' + escapeHtml(e.flag_id) + '</span>'
              : '') +
            (conf ? '<span class="tl-conf">confidence ' + escapeHtml(conf) + '</span>' : '') +
          '</div>' +
          (msg ? '<p class="tl-msg">' + escapeHtml(msg) + '</p>' : '') +
          (e.evidence_path
            ? '<p class="tl-evidence">Evidence: ' + escapeHtml(e.evidence_path) + '</p>'
            : '') +
        '</li>'
      );
    }).join('');
  }

  function summarizeScoreDeductions(events) {
    var phoneRisk = 0;
    var otherNeedsReview = 0;
    var integritySignals = 0;
    var deducted = 0;

    (events || []).forEach(function (e) {
      var flags = e.flags || [];
      var phoneSus = flags.some(function (f) {
        return f.id === 'phone_risk' && f.severity === 'suspicious';
      });
      var sev = e.severity || e.status;
      if (phoneSus || sev === 'suspicious') {
        if (phoneSus || e.flag_id === 'phone_risk') {
          phoneRisk += 1;
          deducted += 12;
        } else {
          otherNeedsReview += 1;
          deducted += 8;
        }
      } else if (sev === 'warning') {
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

  function renderScoreExplain(session, score, timeline) {
    var panel = $('scoreExplainPanel');
    var el = $('sessionScoreBreakdown');
    if (!panel || !el) return;

    panel.hidden = false;

    var scoring = session.report && session.report.scoring;
    var breakdown = scoring && scoring.breakdown;
    if (Array.isArray(breakdown) && breakdown.length) {
      var phoneRisk = 0;
      var other = 0;
      var warns = 0;
      breakdown.forEach(function (b) {
        if (b.severity === 'suspicious' && b.flag_id === 'phone_risk') phoneRisk += 1;
        else if (b.severity === 'suspicious') other += 1;
        else if (b.severity === 'warning') warns += 1;
      });
      var parts = [];
      if (phoneRisk) parts.push(phoneRisk + '× phone_risk (−12)');
      if (other) parts.push(other + '× needs review (−8)');
      if (warns) parts.push(warns + '× integrity signal (−2)');
      el.textContent = parts.length
        ? ('This session: 100 − (' + parts.join(' + ') + ') = ' + (score != null ? Math.round(score) : '—') + '.')
        : ('This session: 100 − 0 = ' + (score != null ? Math.round(score) : '—') + ' (no deductions).');
      return;
    }

    var s = summarizeScoreDeductions(timeline);
    var parts = [];
    if (s.phoneRisk) parts.push(s.phoneRisk + '× phone_risk (−12)');
    if (s.otherNeedsReview) parts.push(s.otherNeedsReview + '× needs review (−8)');
    if (s.integritySignals) parts.push(s.integritySignals + '× integrity signal (−2)');
    var shown = score != null ? Math.round(score) : s.score;
    el.textContent = parts.length
      ? ('This session: 100 − (' + parts.join(' + ') + ') = ' + shown + '.')
      : ('This session: 100 − 0 = ' + shown + ' (no deductions).');
  }

  function render(session) {
    var score = session.integrity_score;
    if (score == null && session.report) score = session.report.integrity_score;
    if (score == null && session.report) score = session.report.integrityScore;

    var duration = session.duration_seconds;
    if (duration == null && session.report) {
      duration = session.report.duration_seconds != null
        ? session.report.duration_seconds
        : session.report.durationSeconds;
    }

    var suspicious = session.suspicious_count != null
      ? session.suspicious_count
      : (session.report && (session.report.suspicious_count || session.report.suspiciousCount)) || 0;
    var warnings = session.warning_count != null
      ? session.warning_count
      : (session.report && (session.report.warning_count || session.report.warningCount)) || 0;

    var student = session.student_name || 'Unnamed student';
    var exam = session.exam_id || 'practice exam';

    $('sessionStudent').textContent = student;
    $('sessionTitle').textContent = exam;
    $('sessionMeta').innerHTML =
      'Status <strong>' + escapeHtml(session.status || '—') + '</strong>' +
      ' · Created ' + escapeHtml(formatClock(session.created_at)) +
      (session.submitted_at ? ' · Submitted ' + escapeHtml(formatClock(session.submitted_at)) : '') +
      '<br><code>' + escapeHtml(session.id) + '</code>';

    var tone = scoreTone(score);
    $('scoreRing').setAttribute('data-tone', tone);
    $('scoreValue').textContent = score != null ? String(Math.round(score)) : '—';

    $('metricDuration').textContent = formatDuration(duration);
    $('metricDurationHint').textContent =
      duration != null
        ? 'Active exam length'
        : 'Duration not recorded';

    $('metricFlags').textContent = suspicious + ' / ' + warnings;
    $('metricFlagsHint').textContent = 'Needs review · integrity signals';

    renderCalibration(pickCalibration(session));

    var timeline = buildTimeline(session);
    // Prefer counts from timeline when DB summary is empty but events exist
    if ((suspicious === 0 && warnings === 0) && timeline.length) {
      var sCount = 0;
      var wCount = 0;
      timeline.forEach(function (e) {
        if ((e.severity || e.status) === 'suspicious') sCount += 1;
        else if ((e.severity || e.status) === 'warning') wCount += 1;
      });
      $('metricFlags').textContent = sCount + ' / ' + wCount;
    }
    renderTimeline(timeline);
    renderScoreExplain(session, score, timeline);
    renderEvidence(session);

    $('loadStatus').hidden = true;
    $('sessionHero').hidden = false;
    $('sessionBody').hidden = false;
  }

  function showError(msg, isWarn) {
    var el = $('loadStatus');
    el.hidden = false;
    el.textContent = msg;
    el.className = 'lib-status ' + (isWarn ? 'warn' : 'err');
    $('sessionHero').hidden = true;
    $('sessionBody').hidden = true;
  }

  function load() {
    var id = queryId();
    if (!id) {
      showError('Missing session id. Open from Sessions, or use session.html?id=<uuid>.', true);
      return;
    }

    fetch('/api/sessions/' + encodeURIComponent(id))
      .then(function (res) {
        if (res.status === 404) {
          throw new Error('Session not found.');
        }
        if (!res.ok) {
          throw new Error('Could not load session (' + res.status + ').');
        }
        return res.json();
      })
      .then(render)
      .catch(function (err) {
        var msg = err && err.message ? err.message : String(err);
        if (/Failed to fetch|NetworkError/i.test(msg)) {
          showError('Could not reach backend. Run: python run_server.py');
        } else {
          showError(msg);
        }
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
