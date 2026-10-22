/* Arrow-key navigation for TV remotes and keyboards: moves focus to the nearest control in the
 * direction pressed, inside whatever layer is on top (a dialog, the full-screen player, or the page). */
(function (root) {
  'use strict';
  var CS = root.CS = root.CS || {};

  var FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), ' +
                  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  // LG webOS remote keys (and their keyboard equivalents).
  var KEYS = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 461, ESC: 27,
    CH_UP: 33, CH_DOWN: 34, RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,
    PLAY: 415, PAUSE: 19, PLAY_PAUSE: 10252, STOP: 413, INFO: 457
  };
  var DIRS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };

  var scopeFn = function () { return document.body; };

  function visible(el) {
    if (el.closest('[hidden], .is-hidden')) return false;
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    var cs = root.getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  function candidates(scope) {
    return Array.prototype.filter.call(scope.querySelectorAll(FOCUSABLE), visible);
  }

  function gap(a1, a2, b1, b2) {          // distance between two ranges on one axis, 0 if they overlap
    return Math.max(0, Math.max(a1, b1) - Math.min(a2, b2));
  }

  function best(from, list, dir) {
    var f = from.getBoundingClientRect(), fx = f.left + f.width / 2, fy = f.top + f.height / 2;
    var winner = null, winnerScore = Infinity;
    list.forEach(function (el) {
      if (el === from || from.contains(el) || el.contains(from)) return;
      var c = el.getBoundingClientRect(), cx = c.left + c.width / 2, cy = c.top + c.height / 2;
      var primary, ortho;
      if (dir === 'down') {
        if (cy <= fy + 1 || c.bottom <= f.bottom) return;
        primary = Math.max(0, c.top - f.bottom);
        ortho = gap(f.left, f.right, c.left, c.right);
      } else if (dir === 'up') {
        if (cy >= fy - 1 || c.top >= f.top) return;
        primary = Math.max(0, f.top - c.bottom);
        ortho = gap(f.left, f.right, c.left, c.right);
      } else if (dir === 'right') {
        if (cx <= fx + 1 || c.right <= f.right) return;
        primary = Math.max(0, c.left - f.right);
        ortho = gap(f.top, f.bottom, c.top, c.bottom);
      } else {
        if (cx >= fx - 1 || c.left >= f.left) return;
        primary = Math.max(0, f.left - c.right);
        ortho = gap(f.top, f.bottom, c.top, c.bottom);
      }
      var along = dir === 'up' || dir === 'down' ? Math.abs(cx - fx) : Math.abs(cy - fy);
      var score = primary + ortho * 4 + along * 0.05;
      if (score < winnerScore) {
        winnerScore = score;
        winner = el;
      }
    });
    return winner;
  }

  function focus(el) {
    if (!el) return false;
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    if (el.scrollIntoView) {
      try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { el.scrollIntoView(false); }
    }
    return true;
  }

  function focusFirst(scope) {
    scope = scope || scopeFn();
    var pref = scope.querySelector('[data-autofocus]');
    if (pref && visible(pref)) return focus(pref);
    return focus(candidates(scope)[0]);
  }

  /** Move focus one step; returns false when there's nothing in that direction. */
  function move(dir) {
    var scope = scopeFn(), from = document.activeElement;
    if (!from || from === document.body || !scope.contains(from) || !visible(from)) return focusFirst(scope);
    return focus(best(from, candidates(scope), dir));
  }

  /** Whether an arrow key belongs to the focused control (moving a text cursor, a slider...). */
  function ownsArrow(el, key) {
    if (!el) return false;
    var tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
      var type = (el.type || 'text').toLowerCase();
      if (type === 'range') return key === KEYS.LEFT || key === KEYS.RIGHT;
      if (type === 'checkbox' || type === 'radio' || type === 'button' || type === 'submit') return false;
      if (key === KEYS.UP || key === KEYS.DOWN) return false;
      try {
        var atStart = el.selectionStart === 0 && el.selectionEnd === 0;
        var atEnd = el.selectionStart === el.value.length;
        return key === KEYS.LEFT ? !atStart : !atEnd;
      } catch (e) {
        return true;
      }
    }
    return false;
  }

  var lastInput = 'pointer';

  /** hoverFocus: on a TV the Magic Remote pointer moves focus too, so the arrows carry on from there. */
  function init(getScope, hoverFocus) {
    scopeFn = getScope;
    // Show focus rings only while the keyboard or remote is in use, not after mouse clicks.
    document.addEventListener('keydown', function (e) {
      lastInput = 'key';
      if (DIRS[e.keyCode] || e.keyCode === 9) document.body.classList.add('kbd');
    }, true);
    document.addEventListener('mousedown', function () {
      lastInput = 'pointer';
      document.body.classList.remove('kbd');
    }, true);
    document.addEventListener('touchstart', function () {
      lastInput = 'pointer';
      document.body.classList.remove('kbd');
    }, { capture: true, passive: true });
    if (hoverFocus) {
      document.addEventListener('mouseover', function (e) {
        var el = e.target && e.target.closest ? e.target.closest(FOCUSABLE) : null;
        if (!el || el === document.activeElement || !scopeFn().contains(el)) return;
        lastInput = 'pointer';
        try { el.focus({ preventScroll: true }); } catch (err) { el.focus(); }
      });
    }
  }

  CS.nav = { KEYS: KEYS, DIRS: DIRS, init: init, move: move, focus: focus, focusFirst: focusFirst,
             ownsArrow: ownsArrow, visible: visible, lastInput: function () { return lastInput; } };
})(this);
