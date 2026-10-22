/* The app: channel groups, the channel list, the player and its controls, settings and sources.
 * One page that adapts to a phone, a computer and an LG TV (remote control and Magic Remote). */
(function (root) {
  'use strict';
  var CS = root.CS;
  CS.VERSION = '1.0.0';
  var T = CS.i18n.t;
  var sources = CS.sources, health = CS.health, store = CS.store, nav = CS.nav, KEYS = CS.nav.KEYS;

  var GROUPS = ['Favourites', 'Football', 'Tennis', 'Cricket', 'News', 'Sports', 'Other', 'All'];
  var GROUP_ICONS = { Favourites: 'star', Football: 'football', Tennis: 'tennis', Cricket: 'cricket',
                      News: 'news', Sports: 'trophy', Other: 'folder', All: 'grid' };
  var STATUS_RANK = { ok: 0, unknown: 1, dead: 2 };
  var FREE_CACHE_KEY = 'free.v1';
  var FREE_TTL = 24 * 3600 * 1000;
  var CHUNK = 120;
  var CONTROLS_HIDE_MS = 4000;

  var S = {
    settings: null,
    freeAll: [],          // free channels for every country (filtered), cached for a day
    free: [],             // the chosen countries' free channels
    freeState: 'loading', // loading / ok / error
    countryNames: {},
    counts: {},           // country -> number of free channels
    paid: {},             // source id -> channels
    sourceInfo: {},       // source id -> {state, count, secure, message}
    byKey: {},
    group: 'Football',
    search: '',
    country: '',
    current: null,
    shown: [],
    rendered: 0,
    rows: {},
    checking: null,
    layers: [],
    afterPop: null,
    full: false,
    fullAuto: false,
    controlsVisible: true,
    lastError: '',
    tv: false,
    packaged: false,
    dialog: null,
    listTouched: 0
  };

  function $(id) { return document.getElementById(id); }

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = !!v;
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function icon(name, cls) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#i-' + name);
    use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  function setIcon(button, name) {
    var old = button.querySelector('svg.icon');
    var fresh = icon(name);
    if (old) button.replaceChild(fresh, old);
    else button.insertBefore(fresh, button.firstChild);
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function save() {
    store.saveSettings(S.settings);
  }

  // --- device ---------------------------------------------------------------------------------

  function detectTV() {
    var q = location.search;
    if (/[?&]tv=1/.test(q)) return true;
    if (/[?&]tv=0/.test(q)) return false;
    return /Web0S|webOS|NetCast|SmartTV|SMART-TV|Tizen|BRAVIA|HbbTV|CrKey|AFT[A-Z]/i.test(navigator.userAgent);
  }

  function isTouch() {
    return root.matchMedia && root.matchMedia('(hover: none) and (pointer: coarse)').matches;
  }

  function applyTheme() {
    var theme = S.tv ? 'dark' : S.settings.theme;
    if (theme === 'system') {
      theme = root.matchMedia && root.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    document.documentElement.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f5f7' : '#0e1014');
  }

  // --- text -----------------------------------------------------------------------------------

  function translatePage() {
    document.documentElement.lang = CS.i18n.lang();
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (el) {
      el.textContent = T(el.getAttribute('data-i18n'));
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n-label]'), function (el) {
      var text = T(el.getAttribute('data-i18n-label'));
      el.setAttribute('aria-label', text);
      if (!S.tv) el.setAttribute('title', text);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n-placeholder]'), function (el) {
      el.setAttribute('placeholder', T(el.getAttribute('data-i18n-placeholder')));
    });
  }

  function groupLabel(g) {
    return T('group.' + g);
  }

  function countryName(code) {
    if (!code) return '';
    var lang = CS.i18n.lang();
    try {
      if (root.Intl && Intl.DisplayNames) {
        var name = new Intl.DisplayNames([lang], { type: 'region' }).of(code === 'UK' ? 'GB' : code);
        if (name && name !== code) return name;
      }
    } catch (e) { /* unknown code */ }
    return S.countryNames[code] || code;
  }

  function setStatus(text) {
    $('status-text').textContent = text;
  }

  var toastTimer = null;

  function toast(text) {
    var el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  // --- layers: dialogs and full screen close with Back / Esc / the phone's back button ------------

  function pushLayer(name, onClose) {
    S.layers.push({ name: name, onClose: onClose });
    try {
      history.pushState({ cs: S.layers.length }, '');
    } catch (e) {
      S.layers[S.layers.length - 1].noHistory = true;
    }
  }

  function topLayer() {
    return S.layers.length ? S.layers[S.layers.length - 1].name : '';
  }

  /** Close the top layer; `then` runs once it's gone (history.back() is asynchronous). */
  function closeTop(then) {
    if (!S.layers.length) {
      if (then) then();
      return;
    }
    S.afterPop = then || null;
    if (S.layers[S.layers.length - 1].noHistory) popLayer();
    else history.back();
  }

  function popLayer() {
    var layer = S.layers.pop();
    if (layer) layer.onClose();
    var then = S.afterPop;
    S.afterPop = null;
    if (then) then();
  }

  function scope() {
    if (S.dialog) return S.dialog.box;
    if (S.full) return $('stage');
    return document.body;
  }

  // --- channels -------------------------------------------------------------------------------

  function allChannels() {
    var list = S.free.slice();
    S.settings.sources.forEach(function (src) {
      if (S.paid[src.id]) list = list.concat(S.paid[src.id]);
    });
    return list;
  }

  function isFav(ch) {
    return S.settings.favourites.indexOf(ch.key) >= 0;
  }

  function status(ch) {
    return sources.channelStatus(ch);
  }

  function sortChannels(list) {
    var lang = CS.i18n.lang();
    return list.map(function (ch) { return [STATUS_RANK[status(ch)], ch.name.toLowerCase(), ch.key, ch]; })
      .sort(function (a, b) {
        if (a[0] !== b[0]) return a[0] - b[0];
        var c = a[1].localeCompare(b[1], lang);
        return c !== 0 ? c : (a[2] < b[2] ? -1 : 1);
      })
      .map(function (x) { return x[3]; });
  }

  function inGroup(ch, group) {
    if (group === 'All') return true;
    if (group === 'Favourites') return isFav(ch);
    return ch.groups.indexOf(group) >= 0;
  }

  function visibleChannels() {
    var q = S.search.trim().toLowerCase();
    var list = allChannels().filter(function (ch) {
      if (S.country && ch.country !== S.country) return false;
      if (q) return (ch.name + ' ' + countryName(ch.country) + ' ' + ch.country).toLowerCase().indexOf(q) >= 0;
      return inGroup(ch, S.group);
    });
    return sortChannels(list);
  }

  function rebuild(keep) {
    S.byKey = {};
    allChannels().forEach(function (ch) { S.byKey[ch.key] = ch; });
    if (S.current && S.byKey[S.current.key]) S.current = S.byKey[S.current.key];
    renderGroups();
    renderCountries();
    renderList({ keep: keep });
  }

  function useFree(data) {
    S.freeAll = data.all;
    S.countryNames = data.names || {};
    S.counts = {};
    var logos = data.logos || {};
    S.freeAll.forEach(function (ch) {
      S.counts[ch.country] = (S.counts[ch.country] || 0) + 1;
      ch.logo = logos[ch.epgId] || '';
    });
    selectFree();
  }

  function selectFree() {
    var wanted = {};
    S.settings.countries.forEach(function (c) { wanted[c] = true; });
    S.free = S.freeAll.filter(function (ch) { return wanted[ch.country]; });
    S.health.apply(S.free);
  }

  async function loadFree(force) {
    S.freeState = 'loading';
    setStatus(T('status.loading'));
    renderList();
    var cached = null;
    try { cached = await store.idbGet(FREE_CACHE_KEY); } catch (e) { cached = null; }
    if (cached && cached.all && !force) {
      useFree(cached);
      if (Date.now() - cached.t < FREE_TTL) {
        freeReady(cached);
        return;
      }
      S.freeState = 'ok';        // show yesterday's list while today's downloads
      rebuild();
      renderIdle();
    }
    try {
      var lists = await Promise.all([sources.iptvOrg('channels'), sources.iptvOrg('streams'),
                                     sources.iptvOrg('blocklist'),
                                     sources.iptvOrg('countries').catch(function () { return []; })]);
      var codes = {}, names = {};
      lists[0].forEach(function (c) { if (c.country) codes[c.country] = true; });
      lists[3].forEach(function (c) { names[c.code] = c.name; });
      var all = sources.buildFreeChannels(lists[0], lists[1], lists[2], Object.keys(codes));
      lists = null;
      var data = { t: Date.now(), all: all, names: names, logos: (cached && cached.logos) || {} };
      useFree(data);
      store.idbSet(FREE_CACHE_KEY, data);
      freeReady(data, true);
    } catch (e) {
      if (cached && cached.all) {
        freeReady(cached);
        setStatus(T('status.freeStale'));
      } else {
        S.freeState = 'error';
        setStatus(T('status.freeFailed'));
        rebuild();
        renderIdle();
      }
    }
  }

  function freeReady(data, fresh) {
    S.freeState = 'ok';
    rebuild();
    renderIdle();
    setStatus(T('status.freeLoaded', { n: S.free.length }));
    if (S.tv && (!document.activeElement || document.activeElement === document.body)) focusList();
    if (S.settings.logos !== false && (fresh || !data.logos || !Object.keys(data.logos).length)) loadLogos(data);
    checkFreeSoon();
  }

  async function loadLogos(data) {
    try {
      data.logos = await sources.loadFreeLogos(data.all);
    } catch (e) {
      return;          // logos are a nicety: without them every channel shows its initials
    }
    data.all.forEach(function (ch) { ch.logo = data.logos[ch.epgId] || ''; });
    store.idbSet(FREE_CACHE_KEY, data);
    renderList({ keep: true });
    updateNowPlaying();
  }

  // --- the user's own sources -------------------------------------------------------------------

  function loadAllSources() {
    S.settings.sources.forEach(function (src) { loadSource(src); });
  }

  function sourceErrorText(e) {
    var code = e && e.code ? e.code : 'download_failed';
    var key = 'source.err.' + code;
    var text = T(key, { detail: (e && e.detail) || (e && e.message) || '' });
    return text === key ? T('source.err.download_failed', { detail: String(e && e.message || e) }) : text;
  }

  async function loadSource(src) {
    S.sourceInfo[src.id] = { state: 'loading' };
    refreshSettings();
    try {
      var full = src;
      if (src.type === 'm3u_file') full = Object.assign({}, src, { text: (await store.idbGet('file:' + src.id)) || '' });
      var res = await sources.loadUserSource(full);
      S.health.apply(res.channels);
      S.paid[src.id] = res.channels;
      S.sourceInfo[src.id] = { state: 'ok', count: res.channels.length, secure: res.secure };
    } catch (e) {
      delete S.paid[src.id];
      S.sourceInfo[src.id] = { state: 'error', message: sourceErrorText(e) };
      setStatus(T('status.sourceFailed', { name: src.name }));
    }
    rebuild(true);
    refreshSettings();
  }

  function newId() {
    return 'src' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }

  function addSource(src, fileText) {
    src.id = newId();
    S.settings.sources.push(src);
    save();
    var ready = fileText !== undefined ? store.idbSet('file:' + src.id, fileText) : Promise.resolve();
    ready.then(function () { loadSource(src); });
  }

  function removeSource(id) {
    S.settings.sources = S.settings.sources.filter(function (s) { return s.id !== id; });
    save();
    delete S.paid[id];
    delete S.sourceInfo[id];
    store.idbSet('file:' + id, null);
    if (S.current && !S.current.free && S.current.key.indexOf(id + ':') === 0) stopPlayback();
    rebuild(true);
    refreshSettings();
  }

  // --- health check -----------------------------------------------------------------------------

  var checkTimer = null;

  function checkFreeSoon() {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(function () {
      var stale = S.free.filter(function (ch) { return status(ch) === 'unknown'; });
      if (stale.length) startCheck(stale, S.tv ? 4 : 8);
    }, 800);
  }

  function startCheck(channels, workers) {
    if (S.checking) return;
    // Check what you're looking at first.
    var shown = {};
    S.shown.forEach(function (ch) { shown[ch.key] = true; });
    channels = channels.filter(function (ch) { return shown[ch.key]; })
      .concat(channels.filter(function (ch) { return !shown[ch.key]; }));
    var job = S.checking = { cancel: { cancelled: false }, done: 0, total: channels.length };
    renderProgress();
    function finish() {
      if (S.checking !== job) return;
      S.checking = null;
      var all = allChannels();
      var live = all.filter(function (ch) { return status(ch) === 'ok'; }).length;
      var dead = all.filter(function (ch) { return status(ch) === 'dead'; }).length;
      setStatus(T('status.checkDone', { live: live, dead: dead }));
      renderGroups();
      renderList({ keep: true });
      renderProgress();
    }
    health.checkChannels(channels, S.health, {
      workers: workers,
      nativeHls: S.player.caps.nativeHls,
      cancel: job.cancel,
      progress: function (done, total, ch) {
        job.done = done;
        updateRow(ch);
        if (done % 10 === 0 || done === total) renderProgress();
        if (done % 60 === 0) maybeResort();
      }
    }).then(finish, finish);
  }

  function maybeResort() {
    // Let working channels rise to the top now and then, unless you're busy in the list.
    var list = $('list-scroll');
    if (list.scrollTop > 0 || list.contains(document.activeElement) || Date.now() - S.listTouched < 5000) return;
    renderList({ keep: true });
  }

  async function checkVisible() {
    var chans = S.shown.slice();
    if (!chans.length) return;
    if (S.checking) {
      toast(T('check.already'));
      return;
    }
    var free = chans.filter(function (ch) { return ch.free; });
    var paid = chans.filter(function (ch) { return !ch.free; });
    if (paid.length && !(await confirmDialog(T('check.paidTitle'), T('check.paidText', { n: paid.length }),
                                             T('check.paidOk')))) {
      paid = [];
    }
    if (free.length) startCheck(free, S.tv ? 4 : 8);
    else if (paid.length) startCheck(paid, 1);
  }

  function renderProgress() {
    var job = S.checking, bar = $('progress');
    if (!job) {
      bar.hidden = true;
      renderIdle();
      return;
    }
    bar.hidden = false;
    $('progress-fill').style.width = Math.round(job.done / Math.max(job.total, 1) * 100) + '%';
    setStatus(T('status.checking', { done: job.done, total: job.total }));
    renderIdle();
  }

  // --- groups -----------------------------------------------------------------------------------

  var groupFocusTimer = null;

  function renderGroups() {
    var counts = {}, all = allChannels();
    GROUPS.forEach(function (g) { counts[g] = 0; });
    all.forEach(function (ch) {
      counts.All++;
      if (isFav(ch)) counts.Favourites++;
      ch.groups.forEach(function (g) { if (g in counts) counts[g]++; });
    });
    var nav_ = $('groups'), focusedGroup = document.activeElement && document.activeElement.getAttribute('data-group');
    clear(nav_);
    GROUPS.forEach(function (g) {
      if (!counts[g] && g !== 'Favourites' && g !== S.group && g !== 'All') return;
      var active = !S.search && g === S.group;
      var btn = h('button', {
        class: 'group' + (active ? ' is-active' : ''), type: 'button', 'data-group': g,
        'aria-current': active ? 'true' : null,
        onclick: function () { selectGroup(g); },
        onfocus: function () {
          if (!S.tv || nav.lastInput() !== 'key') return;
          clearTimeout(groupFocusTimer);   // on a TV, moving onto a group shows it
          groupFocusTimer = setTimeout(function () {
            if (document.activeElement === btn && (S.group !== g || S.search)) selectGroup(g, true);
          }, 350);
        }
      }, [icon(GROUP_ICONS[g]), h('span', { class: 'group-label', text: groupLabel(g) }),
          h('span', { class: 'group-count', text: String(counts[g]) })]);
      nav_.appendChild(btn);
      if (focusedGroup === g) btn.focus();
    });
  }

  function selectGroup(g, keepFocus) {
    S.group = g;
    S.settings.lastGroup = g;
    save();
    if (S.search) {
      S.search = '';
      $('search').value = '';
      $('search-clear').hidden = true;
    }
    renderGroups();
    renderList();
    $('list-scroll').scrollTop = 0;
    if (!keepFocus && document.body.classList.contains('kbd')) focusList();
  }

  function renderCountries() {
    var sel = $('country'), present = {};
    allChannels().forEach(function (ch) { if (ch.country) present[ch.country] = true; });
    var codes = Object.keys(present).sort(function (a, b) {
      return countryName(a).localeCompare(countryName(b), CS.i18n.lang());
    });
    if (S.country && !present[S.country]) S.country = '';
    clear(sel);
    sel.appendChild(h('option', { value: '', text: T('list.allCountries') }));
    codes.forEach(function (c) { sel.appendChild(h('option', { value: c, text: countryName(c) })); });
    sel.value = S.country;
    sel.hidden = codes.length < 2;
  }

  // --- the channel list -------------------------------------------------------------------------

  var observer = null;

  var NOT_ALNUM = (function () {
    try { return new RegExp('[^\\p{L}\\p{N} ]', 'gu'); } catch (e) { return /[^\w ]/g; }
  })();

  function initials(name) {
    var words = name.replace(NOT_ALNUM, ' ').split(/\s+/).filter(Boolean);
    return ((words[0] || '?')[0] + (words[1] ? words[1][0] : '')).toUpperCase();
  }

  function hue(text) {
    var x = 0;
    for (var i = 0; i < text.length; i++) x = (x * 31 + text.charCodeAt(i)) % 360;
    return x;
  }

  function logoEl(ch, cls) {
    var box = h('span', { class: 'logo' + (cls ? ' ' + cls : '') });
    var fallback = function () {
      clear(box);
      box.classList.add('logo-text');
      box.style.backgroundColor = 'hsl(' + hue(ch.name) + ', 45%, 32%)';
      box.textContent = initials(ch.name);
    };
    if (ch.logo && S.settings.logos !== false) {
      box.appendChild(h('img', { src: ch.logo, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer',
                                 decoding: 'async', onerror: fallback }));
    } else {
      fallback();
    }
    return box;
  }

  function subtitle(ch) {
    var parts = [];
    if (ch.country) parts.push(countryName(ch.country));
    var g = ch.groups.filter(function (x) { return x !== 'Other'; })[0];
    if (g && (S.search || S.group === 'All' || S.group === 'Favourites')) parts.push(groupLabel(g));
    if (!ch.free) parts.push(ch.source);
    return parts.join(' · ');
  }

  function badge(ch) {
    if (S.current && S.current.key === ch.key) {
      return h('span', { class: 'badge badge-playing' }, [h('span', { class: 'eq' }, [h('i'), h('i'), h('i')]),
                                                          T('badge.playing')]);
    }
    var st = status(ch);
    if (st === 'ok') return h('span', { class: 'badge badge-ok' }, [h('span', { class: 'dot' }), T('badge.live')]);
    if (st === 'dead') return h('span', { class: 'badge badge-dead', text: T('badge.dead') });
    return null;
  }

  function favButton(ch) {
    var fav = isFav(ch), label = T(fav ? 'fav.remove' : 'fav.add');
    return h('button', {
      class: 'fav' + (fav ? ' is-on' : ''), type: 'button', 'aria-pressed': fav ? 'true' : 'false',
      'aria-label': label + ': ' + ch.name, title: S.tv ? null : label,
      onclick: function () { toggleFav(ch); }
    }, [icon(fav ? 'star-fill' : 'star')]);
  }

  function rowClass(ch) {
    return 'row' + (status(ch) === 'dead' ? ' is-dead' : '') +
           (S.current && S.current.key === ch.key ? ' is-playing' : '');
  }

  function rowFor(ch) {
    var li = h('li', { class: rowClass(ch) });
    li.appendChild(h('button', {
      class: 'ch', type: 'button', 'data-key': ch.key,
      onclick: function () { playChannel(ch, true); }
    }, [logoEl(ch), h('span', { class: 'meta' }, [h('span', { class: 'name', text: ch.name }),
                                                    h('span', { class: 'sub', text: subtitle(ch) })]),
        badge(ch)]));
    li.appendChild(favButton(ch));
    S.rows[ch.key] = li;
    return li;
  }

  /** Refresh one row in place, so a tap or the remote's focus on it isn't lost mid-check. */
  function updateRow(ch) {
    var li = S.rows[ch.key];
    if (!li || !li.parentNode) return;
    li.className = rowClass(ch);
    var main = li.querySelector('.ch'), old = main.querySelector('.badge'), fresh = badge(ch);
    if (old) main.removeChild(old);
    if (fresh) main.appendChild(fresh);
    var oldFav = li.querySelector('.fav'), hadFocus = document.activeElement === oldFav;
    var newFav = favButton(ch);
    li.replaceChild(newFav, oldFav);
    if (hadFocus) newFav.focus({ preventScroll: true });
  }

  function renderList(opts) {
    opts = opts || {};
    var scroller = $('list-scroll'), ul = $('channel-list');
    var scrollTop = scroller.scrollTop, keepCount = opts.keep ? S.rendered : 0;
    var focused = document.activeElement, focusKey = null, focusFav = false;
    if (focused && ul.contains(focused)) {
      var holder = focused.closest('.row');
      var main = holder && holder.querySelector('.ch');
      focusKey = main && main.getAttribute('data-key');
      focusFav = focused.classList.contains('fav');
    }
    var list = visibleChannels();
    S.shown = list;
    $('list-title').textContent = S.search ? T('list.searchTitle', { q: S.search.trim() }) : groupLabel(S.group);
    $('list-count').textContent = list.length ? T('list.count', { n: list.length }) : '';
    clear(ul);
    S.rows = {};
    S.rendered = 0;
    if (observer) observer.disconnect();
    do {
      appendChunk();
    } while (S.rendered < Math.min(keepCount, list.length));
    renderEmpty(list);
    if (opts.keep) scroller.scrollTop = scrollTop;
    if (focusKey && S.rows[focusKey]) {
      var el = S.rows[focusKey].querySelector(focusFav ? '.fav' : '.ch');
      if (el) el.focus({ preventScroll: true });
    }
  }

  function appendChunk() {
    var ul = $('channel-list'), list = S.shown;
    var old = ul.querySelector('.more');
    if (old) ul.removeChild(old);
    var end = Math.min(S.rendered + CHUNK, list.length);
    var frag = document.createDocumentFragment();
    for (var i = S.rendered; i < end; i++) frag.appendChild(rowFor(list[i]));
    ul.appendChild(frag);
    S.rendered = end;
    if (end >= list.length) return;
    var more = h('li', { class: 'more', 'aria-hidden': 'true' });
    ul.appendChild(more);
    if (typeof IntersectionObserver !== 'function') {
      appendChunk();
      return;
    }
    if (!observer) {
      observer = new IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; })) appendChunk();
      }, { root: $('list-scroll'), rootMargin: '600px' });
    }
    observer.disconnect();
    observer.observe(more);
  }

  function renderEmpty(list) {
    var box = $('empty');
    clear(box);
    if (list.length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    if (S.freeState === 'loading' && !S.free.length) {
      box.appendChild(h('div', { class: 'spinner-inline' }));
      box.appendChild(h('p', { text: T('empty.loading') }));
    } else if (S.freeState === 'error' && !S.free.length) {
      box.appendChild(h('p', { text: T('empty.error') }));
      box.appendChild(h('button', { class: 'btn btn-primary', type: 'button', text: T('action.retry'),
                                    onclick: function () { loadFree(true); } }));
    } else if (S.search) {
      box.appendChild(h('p', { text: T('empty.search', { q: S.search.trim() }) }));
    } else if (S.group === 'Favourites') {
      box.appendChild(icon('star', 'empty-icon'));
      box.appendChild(h('p', { text: T('empty.favourites') }));
    } else if (S.country) {
      box.appendChild(h('p', { text: T('empty.country') }));
    } else {
      box.appendChild(h('p', { text: T('empty.group') }));
    }
  }

  function focusList() {
    var first = S.current && S.rows[S.current.key] ? S.rows[S.current.key].querySelector('.ch')
      : $('channel-list').querySelector('.ch');
    if (first) nav.focus(first);
    else nav.focus($('groups').querySelector('.is-active') || $('groups').querySelector('.group'));
  }

  function toggleFav(ch) {
    var favs = S.settings.favourites, i = favs.indexOf(ch.key);
    if (i >= 0) favs.splice(i, 1);
    else favs.push(ch.key);
    save();
    toast(T(i >= 0 ? 'fav.removed' : 'fav.added', { name: ch.name }));
    renderGroups();
    if (S.group === 'Favourites' && !S.search) renderList({ keep: true });
    else updateRow(ch);
    updateNowPlaying();
  }

  // --- playback ---------------------------------------------------------------------------------

  function playChannel(ch, fromList) {
    var prev = S.current;
    S.current = ch;
    S.lastError = '';
    $('tap-play').hidden = true;
    S.settings.lastChannel = ch.key;
    save();
    S.player.buffer = S.settings.buffer;
    S.player.setFit(S.settings.fit[ch.key] || 'auto');
    S.player.play(ch);
    document.body.classList.add('has-player');
    renderIdle();
    updateNowPlaying();
    if (prev) updateRow(prev);
    updateRow(ch);
    setMediaSession(ch);
    if (fromList && S.tv && !S.full) enterFull();
  }

  function stopPlayback() {
    var prev = S.current;
    S.player.stop();
    S.current = null;
    S.lastError = '';
    if (S.full) closeTop();
    document.body.classList.remove('has-player');
    $('spinner').hidden = true;
    $('tap-play').hidden = true;
    updateNowPlaying();
    renderIdle();
    if (prev) updateRow(prev);
  }

  /** Previous/next channel in the list you're looking at. */
  function zap(step) {
    var list = S.shown.length ? S.shown : sortChannels(allChannels());
    if (!list.length) return;
    var i = S.current ? list.indexOf(S.current) : -1;
    if (i < 0 && S.current) {
      for (var j = 0; j < list.length; j++) if (list[j].key === S.current.key) i = j;
    }
    var next = i < 0 ? list[step > 0 ? 0 : list.length - 1] : list[(i + step + list.length) % list.length];
    playChannel(next, false);
    showOsd();
  }

  function streamLabel(info) {
    return info && info.n > 1 ? T('play.streamOf', { i: info.idx + 1, n: info.n }) : '';
  }

  function reasonText(reason) {
    return T('reason.' + (reason || 'error'));
  }

  function onPlayerEvent(kind, info, channel, stream) {
    var msg = '', busy = false;
    if (kind === 'opening') {
      msg = T('play.opening') + streamLabel(info);
      busy = true;
    } else if (kind === 'playing') {
      msg = T('play.playing') + streamLabel(info);
      stream.status = 'ok';
      S.health.put(stream.url, 'ok');
      S.health.save();
      $('tap-play').hidden = true;
    } else if (kind === 'reconnecting') {
      msg = info.still ? T('play.still') : T(info.lost ? 'play.lost' : 'play.cantStart',
                                             { reason: reasonText(info.reason), delay: info.delay });
      busy = true;
    } else if (kind === 'switching') {
      msg = T('play.switching', { i: info.idx + 1, n: info.n });
      busy = true;
    } else if (kind === 'stream_dead') {
      stream.status = 'dead';
      S.health.put(stream.url, 'dead');
      return;
    } else if (kind === 'failed') {
      if (!info.noStreams && !info.unsupported) {
        channel.streams.forEach(function (s) { s.status = 'dead'; S.health.put(s.url, 'dead'); });
      }
      S.health.save();
      msg = info.noStreams ? T('play.noStreams') : info.unsupported ? T('play.unsupported') : T('play.failed');
    } else if (kind === 'lost') {
      msg = T('play.gaveUp');
    } else if (kind === 'needs_tap') {
      $('tap-play').hidden = false;
      $('spinner').hidden = true;
      return;
    } else if (kind === 'levels') {
      updateQualityButton();
      return;
    } else if (kind === 'state') {
      updatePlayButton();
      return;
    }
    if (S.current && channel && channel.key === S.current.key) {
      $('np-status').textContent = msg;
      $('osd-status').textContent = msg;
      $('np-status').className = 'np-status' + (kind === 'playing' ? ' is-ok' : busy ? ' is-busy' : '');
    }
    $('spinner').hidden = !busy;
    if (kind === 'failed' || kind === 'lost') {
      S.lastError = msg;
      S.current = null;
      $('spinner').hidden = true;
      updateNowPlaying();
      renderIdle();
      if (S.full) closeTop();
    }
    if ((kind === 'playing' || kind === 'failed' || kind === 'lost') && channel) updateRow(channel);
    updatePlayButton();
  }

  function renderInfo() {
    var ch = S.current, facts = $('info-facts');
    $('info-title').textContent = T(ch ? 'info.title' : 'info.titleIdle');
    $('info-keys').textContent = T(S.tv ? 'info.keysTv' : isTouch() ? '' : 'info.keys');
    clear(facts);
    facts.hidden = !ch;
    if (!ch) return;
    var groups = ch.groups.filter(function (g) { return g !== 'Other'; }).map(groupLabel).join(', ');
    var rows = [[T('info.country'), countryName(ch.country)], [T('info.groups'), groups],
                [T('info.source'), ch.free ? T('info.free') : ch.source],
                [T('info.streams'), T(ch.streams.length > 1 ? 'info.streamsMany' : 'info.streamsOne',
                                      { n: ch.streams.length })]];
    rows.forEach(function (r) {
      if (!r[1]) return;
      facts.appendChild(h('dt', { text: r[0] }));
      facts.appendChild(h('dd', { text: r[1] }));
    });
  }

  function updateNowPlaying() {
    var ch = S.current, logo = $('np-logo');
    renderInfo();
    clear(logo);
    $('bar').classList.toggle('is-empty', !ch);
    if (!ch) {
      $('np-name').textContent = S.lastError ? T('np.stopped') : T('np.nothing');
      $('np-status').textContent = S.lastError || '';
      $('np-status').className = 'np-status';
      $('osd-name').textContent = '';
      $('b-fav').hidden = true;
      updateQualityButton();
      updatePlayButton();
      return;
    }
    logo.appendChild(logoEl(ch, 'logo-np'));
    $('np-name').textContent = ch.name;
    $('osd-name').textContent = ch.name;
    var fav = isFav(ch), favBtn = $('b-fav');
    favBtn.hidden = false;
    favBtn.classList.toggle('is-on', fav);
    favBtn.setAttribute('aria-pressed', fav ? 'true' : 'false');
    setIcon(favBtn, fav ? 'star-fill' : 'star');
    var label = T(fav ? 'fav.remove' : 'fav.add');
    favBtn.setAttribute('aria-label', label);
    if (!S.tv) favBtn.setAttribute('title', label);
    updateQualityButton();
    updatePlayButton();
  }

  function updatePlayButton() {
    var btn = $('b-play'), paused = !S.current || S.player.video.paused;
    setIcon(btn, paused ? 'play' : 'pause');
    var label = T(paused ? 'ctl.play' : 'ctl.pause');
    btn.setAttribute('aria-label', label);
    if (!S.tv) btn.setAttribute('title', label);
  }

  function updateQualityButton() {
    $('b-quality').hidden = !S.current || S.player.levels().length < 2;
  }

  function renderIdle() {
    var box = $('idle');
    clear(box);
    var playing = !!S.current;
    box.hidden = playing;
    $('screen').classList.toggle('is-idle', !playing);
    if (playing) return;
    if (S.lastError) {
      box.appendChild(icon('alert', 'idle-icon'));
      box.appendChild(h('p', { class: 'idle-text', text: S.lastError }));
      return;
    }
    box.appendChild(h('div', { class: 'idle-brand' }, [h('img', { src: 'icons/icon.svg', alt: '' }),
                                                        h('span', { text: 'Clearstream' })]));
    box.appendChild(h('p', { class: 'idle-title', text: T(S.tv ? 'idle.titleTv' : 'idle.title') }));
    if (S.checking) {
      box.appendChild(h('p', { class: 'idle-text', text: T('idle.checking', { done: S.checking.done,
                                                                              total: S.checking.total }) }));
    } else if (S.freeState === 'error' && !S.free.length) {
      box.appendChild(h('p', { class: 'idle-text', text: T('empty.error') }));
    }
    var last = S.byKey[S.settings.lastChannel];
    if (last) {
      box.appendChild(h('button', { class: 'btn btn-primary', type: 'button',
                                    onclick: function () { playChannel(last, true); } },
                        [icon('play'), T('idle.continue', { name: last.name })]));
    }
  }

  // --- controls and full screen -------------------------------------------------------------------

  var hideTimer = null;

  function showControls(focusControls) {
    S.controlsVisible = true;
    $('stage').classList.remove('controls-hidden');
    clearTimeout(hideTimer);
    if (focusControls) nav.focus($('b-play'));
    if (!S.full) return;
    hideTimer = setTimeout(function () {
      if (!S.full || $('stage').querySelector('select:focus')) return;
      S.controlsVisible = false;
      $('stage').classList.add('controls-hidden');
      if ($('stage').contains(document.activeElement)) document.activeElement.blur();
    }, CONTROLS_HIDE_MS);
  }

  var osdTimer = null;

  function showOsd() {
    if (!S.full) return;
    $('osd').classList.add('show');
    clearTimeout(osdTimer);
    osdTimer = setTimeout(function () { $('osd').classList.remove('show'); }, 4000);
  }

  function fsElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function enterFull(auto) {
    if (S.full) return;
    var de = document.documentElement, video = S.player.video;
    // iPhone has no full screen for pages, only its own video player.
    if (!S.tv && !auto && !de.requestFullscreen && !de.webkitRequestFullscreen && video.webkitEnterFullscreen) {
      try { video.webkitEnterFullscreen(); } catch (e) { /* not ready yet */ }
      return;
    }
    S.full = true;
    S.fullAuto = !!auto;
    document.body.classList.add('is-full');
    pushLayer('full', exitFullNow);
    if (!S.tv && !auto) {
      try {
        var p = de.requestFullscreen ? de.requestFullscreen() : de.webkitRequestFullscreen();
        if (p && p.catch) p.catch(function () {});
      } catch (e) { /* the page still fills the window */ }
    }
    showControls(false);
    showOsd();
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  }

  function exitFullNow() {
    S.full = false;
    S.fullAuto = false;
    clearTimeout(hideTimer);
    document.body.classList.remove('is-full');
    $('stage').classList.remove('controls-hidden');
    $('osd').classList.remove('show');
    S.controlsVisible = true;
    if (fsElement()) {
      try {
        var p = document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen();
        if (p && p.catch) p.catch(function () {});
      } catch (e) { /* already left */ }
    }
    if (S.tv || document.body.classList.contains('kbd')) setTimeout(focusList, 0);
  }

  function toggleFull() {
    if (S.full) {
      if (topLayer() === 'full') closeTop();
    } else if (S.current) {
      enterFull();
    }
  }

  function onFullscreenChange() {
    // Leaving the browser's full screen (Esc, swipe) also leaves ours.
    if (!fsElement() && S.full && !S.fullAuto && !S.tv && topLayer() === 'full') closeTop();
  }

  function pickFit() {
    if (!S.current) return;
    var ch = S.current, cur = S.settings.fit[ch.key] || 'auto';
    choiceDialog(T('fit.title'), CS.player.FITS.map(function (f) {
      return { value: f, label: T('fit.' + f), selected: f === cur };
    }), function (value) {
      if (value === 'auto') delete S.settings.fit[ch.key];
      else S.settings.fit[ch.key] = value;
      save();
      S.player.setFit(value);
      toast(T('fit.set', { fit: T('fit.' + value) }));
    });
  }

  function pickQuality() {
    var levels = S.player.levels(), cur = S.player.currentLevel();
    var opts = [{ value: -1, label: T('quality.auto'), selected: cur === -1 }];
    levels.slice().sort(function (a, b) { return b.height - a.height || b.bitrate - a.bitrate; })
      .forEach(function (l) {
        var label = l.height ? l.height + 'p' : Math.round(l.bitrate / 1000) + ' kbit/s';
        if (l.height && l.bitrate) label += ' · ' + (l.bitrate / 1e6).toFixed(1) + ' Mbit/s';
        opts.push({ value: l.index, label: label, selected: cur === l.index });
      });
    choiceDialog(T('quality.title'), opts, function (value) { S.player.setLevel(value); });
  }

  function applyVolume() {
    var v = S.player.video;
    v.volume = Math.max(0, Math.min(1, Number(S.settings.volume)));
    v.muted = !!S.settings.muted;
    $('vol').value = String(v.volume);
    setIcon($('b-mute'), v.muted || v.volume === 0 ? 'mute' : 'volume');
  }

  function toggleMute() {
    S.settings.muted = !S.settings.muted;
    save();
    applyVolume();
  }

  function setMediaSession(ch) {
    var ms = navigator.mediaSession;
    if (!ms || typeof MediaMetadata !== 'function') return;
    try {
      var art = ch.logo ? [{ src: ch.logo, sizes: '512x512' }] : [{ src: 'icons/icon-512.png', sizes: '512x512',
                                                                    type: 'image/png' }];
      ms.metadata = new MediaMetadata({ title: ch.name, artist: 'Clearstream', album: countryName(ch.country),
                                        artwork: art });
      ms.setActionHandler('play', function () { S.player.resume(); });
      ms.setActionHandler('pause', function () { if (!S.player.video.paused) S.player.togglePause(); });
      ms.setActionHandler('previoustrack', function () { zap(-1); });
      ms.setActionHandler('nexttrack', function () { zap(1); });
    } catch (e) { /* older browsers support only some actions */ }
  }

  // --- dialogs ----------------------------------------------------------------------------------

  /** opts: {title, body (Node), wide, onClose}. Returns the dialog. */
  function openDialog(opts) {
    var opener = document.activeElement;
    var titleId = 'dlg-' + Date.now();
    var closeBtn = h('button', { class: 'icon-btn dlg-close', type: 'button', 'aria-label': T('action.close'),
                                 title: S.tv ? null : T('action.close'), onclick: function () { closeTop(); } },
                     [icon('close')]);
    var body = h('div', { class: 'dlg-body' }, [opts.body]);
    var box = h('div', { class: 'dialog' + (opts.wide ? ' dialog-wide' : ''), role: 'dialog', 'aria-modal': 'true',
                         'aria-labelledby': titleId },
                [h('div', { class: 'dlg-head' }, [h('h2', { id: titleId, text: opts.title }), closeBtn]), body]);
    var overlay = h('div', { class: 'overlay' }, [box]);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) closeTop(); });
    $('dialog-root').appendChild(overlay);
    var dlg = { box: box, body: body, overlay: overlay, title: box.querySelector('h2'), parent: S.dialog };
    S.dialog = dlg;
    pushLayer('dialog', function () {
      overlay.parentNode.removeChild(overlay);
      S.dialog = dlg.parent;
      if (opts.onClose) opts.onClose();
      if (opener && opener.focus && document.body.contains(opener)) {
        try { opener.focus({ preventScroll: true }); } catch (e) { opener.focus(); }
      }
    });
    setTimeout(function () { if (!nav.focusFirst(body)) nav.focusFirst(box); }, 0);
    return dlg;
  }

  function setDialogBody(dlg, title, node) {
    dlg.title.textContent = title;
    clear(dlg.body);
    dlg.body.appendChild(node);
    dlg.body.scrollTop = 0;
    setTimeout(function () { if (!nav.focusFirst(dlg.body)) nav.focusFirst(dlg.box); }, 0);
  }

  function choiceDialog(title, options, onPick) {
    var picked = null;
    var list = h('div', { class: 'choices' }, options.map(function (o) {
      return h('button', { class: 'choice' + (o.selected ? ' is-selected' : ''), type: 'button',
                           'data-autofocus': o.selected ? true : null,
                           onclick: function () { picked = o; closeTop(); } },
               [icon(o.selected ? 'check' : 'blank'), h('span', { text: o.label })]);
    }));
    openDialog({ title: title, body: list, onClose: function () { if (picked) onPick(picked.value); } });
  }

  function confirmDialog(title, text, okLabel) {
    return new Promise(function (resolve) {
      var ok = false;
      var body = h('div', {}, [
        h('p', { class: 'dlg-text', text: text }),
        h('div', { class: 'dlg-actions' }, [
          h('button', { class: 'btn', type: 'button', text: T('action.cancel'), onclick: function () { closeTop(); } }),
          h('button', { class: 'btn btn-primary', type: 'button', text: okLabel, 'data-autofocus': true,
                        onclick: function () { ok = true; closeTop(); } })
        ])
      ]);
      openDialog({ title: title, body: body, onClose: function () { resolve(ok); } });
    });
  }

  // --- settings ---------------------------------------------------------------------------------

  function field(labelText, control, hint) {
    return h('label', { class: 'field' }, [h('span', { class: 'field-label', text: labelText }), control,
                                           hint ? h('span', { class: 'field-hint', text: hint }) : null]);
  }

  function selectEl(value, options, onChange) {
    var sel = h('select', { class: 'input', onchange: function () { onChange(sel.value); } },
                options.map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
    sel.value = value;
    return sel;
  }

  function settingsBody() {
    var st = S.settings;
    var wrap = h('div', { class: 'settings' });

    // General
    var general = h('section', { class: 'set-section' }, [h('h3', { text: T('set.general') })]);
    general.appendChild(field(T('set.language'), selectEl(st.lang, [['auto', T('set.langAuto')], ['sv', 'Svenska'],
                                                                     ['en', 'English']], function (v) {
      st.lang = v;
      save();
      CS.i18n.setLang(v);
      translatePage();
      rebuild(true);
      updateNowPlaying();
      renderIdle();
      refreshSettings(true);
    })));
    if (!S.tv) {
      general.appendChild(field(T('set.theme'), selectEl(st.theme, [['dark', T('set.themeDark')],
                                                                    ['light', T('set.themeLight')],
                                                                    ['system', T('set.themeSystem')]], function (v) {
        st.theme = v;
        save();
        applyTheme();
      })));
    }
    general.appendChild(field(T('set.buffer'), selectEl(st.buffer, [['short', T('set.bufferShort')],
                                                                    ['normal', T('set.bufferNormal')],
                                                                    ['long', T('set.bufferLong')]], function (v) {
      st.buffer = v;
      save();
      if (S.current) {
        S.player.buffer = v;
        toast(T('set.bufferNext'));
      }
    }), S.player.caps.preferNative ? T('set.bufferNative') : null));
    var logos = h('input', { type: 'checkbox', checked: st.logos !== false, onchange: function () {
      st.logos = logos.checked;
      save();
      if (logos.checked) loadFree();
      rebuild(true);
      updateNowPlaying();
    } });
    general.appendChild(h('label', { class: 'check' }, [logos, h('span', { text: T('set.logos') })]));
    wrap.appendChild(general);

    // Countries
    var countries = h('section', { class: 'set-section' }, [h('h3', { text: T('set.countries') }),
                                                             h('p', { class: 'field-hint', text: T('set.countriesHint') })]);
    var codes = Object.keys(S.counts);
    st.countries.forEach(function (c) { if (codes.indexOf(c) < 0) codes.push(c); });
    codes.sort(function (a, b) {
      var sa = st.countries.indexOf(a) >= 0, sb = st.countries.indexOf(b) >= 0;
      if (sa !== sb) return sa ? -1 : 1;
      return countryName(a).localeCompare(countryName(b), CS.i18n.lang());
    });
    var grid = h('div', { class: 'country-grid' });
    codes.forEach(function (code) {
      var cb = h('input', { type: 'checkbox', checked: st.countries.indexOf(code) >= 0, onchange: function () {
        var i = st.countries.indexOf(code);
        if (cb.checked && i < 0) st.countries.push(code);
        if (!cb.checked && i >= 0) st.countries.splice(i, 1);
        save();
        selectFree();
        rebuild(true);
        S.countriesChanged = true;
      } });
      grid.appendChild(h('label', { class: 'check country', 'data-name': countryName(code).toLowerCase() },
                         [cb, h('span', { text: countryName(code) }),
                          h('span', { class: 'count', text: String(S.counts[code] || 0) })]));
    });
    if (codes.length > 12) {
      var filter = h('input', { class: 'input', type: 'search', placeholder: T('set.countryFilter'),
                                oninput: function () {
                                  var q = filter.value.trim().toLowerCase();
                                  Array.prototype.forEach.call(grid.children, function (el) {
                                    el.hidden = q && el.getAttribute('data-name').indexOf(q) < 0;
                                  });
                                } });
      countries.appendChild(filter);
    }
    countries.appendChild(grid);
    wrap.appendChild(countries);

    // My sources
    var srcs = h('section', { class: 'set-section' }, [h('h3', { text: T('set.sources') }),
                                                        h('p', { class: 'field-hint', text: T('set.sourcesHint') })]);
    if (!st.sources.length) srcs.appendChild(h('p', { class: 'muted', text: T('set.noSources') }));
    st.sources.forEach(function (src) {
      var info = S.sourceInfo[src.id] || { state: 'loading' }, text;
      if (info.state === 'loading') text = T('source.loading');
      else if (info.state === 'error') text = info.message;
      else text = T('source.ok', { n: info.count }) +
                  (src.type === 'm3u_file' ? '' : ' · ' + T(info.secure ? 'source.secure' : 'source.insecure'));
      srcs.appendChild(h('div', { class: 'source-row' + (info.state === 'error' ? ' is-error' : '') }, [
        h('div', { class: 'source-meta' }, [h('strong', { text: src.name }), h('span', { text: T('source.type.' + src.type) }),
                                            h('span', { class: 'source-info', text: text })]),
        h('button', { class: 'btn btn-small', type: 'button', text: T('action.reload'),
                      onclick: function () { loadSource(src); } }),
        h('button', { class: 'btn btn-small btn-danger', type: 'button', text: T('action.remove'),
                      onclick: function () {
                        confirmDialog(T('source.removeTitle'), T('source.removeText', { name: src.name }), T('action.remove'))
                          .then(function (yes) { if (yes) removeSource(src.id); });
                      } })
      ]));
    });
    var adds = h('div', { class: 'btn-row' }, [
      h('button', { class: 'btn', type: 'button', onclick: function () { sourceForm('m3u_url'); } },
        [icon('plus'), T('source.addUrl')]),
      S.tv ? null : h('button', { class: 'btn', type: 'button', onclick: function () { sourceForm('m3u_file'); } },
                      [icon('plus'), T('source.addFile')]),
      h('button', { class: 'btn', type: 'button', onclick: function () { sourceForm('xtream'); } },
        [icon('plus'), T('source.addXtream')])
    ]);
    srcs.appendChild(adds);
    wrap.appendChild(srcs);

    // Channels
    wrap.appendChild(h('section', { class: 'set-section' }, [
      h('h3', { text: T('set.channels') }),
      h('div', { class: 'btn-row' }, [
        h('button', { class: 'btn', type: 'button', onclick: function () { closeTop(checkVisible); } },
          [icon('refresh'), T('set.checkNow')]),
        h('button', { class: 'btn', type: 'button', onclick: function () {
          closeTop(function () {
            loadFree(true);
            loadAllSources();
          });
        } }, [icon('download'), T('set.reloadLists')])
      ])
    ]));

    // Help and about
    wrap.appendChild(h('section', { class: 'set-section' }, [
      h('h3', { text: T('set.help') }),
      h('ul', { class: 'help-list' }, T(S.tv ? 'help.tv' : 'help.keys').split('\n').map(function (line) {
        return h('li', { text: line });
      })),
      h('h3', { text: T('set.about') }),
      h('p', { class: 'dlg-text', text: T('about.text') }),
      h('p', { class: 'dlg-text', text: T('about.free') }),
      h('p', { class: 'dlg-text muted', text: T('about.version', { v: CS.VERSION }) })
    ]));
    return wrap;
  }

  function openSettings() {
    S.countriesChanged = false;
    var dlg = openDialog({ title: T('set.title'), body: settingsBody(), wide: true, onClose: function () {
      S.settingsDialog = null;
      if (S.countriesChanged) checkFreeSoon();
    } });
    S.settingsDialog = dlg;
  }

  function refreshSettings(force) {
    var dlg = S.settingsDialog;
    if (!dlg || S.dialog !== dlg || dlg.form) return;
    var scroll = dlg.body.scrollTop, active = document.activeElement, idx = -1;
    var focusables = dlg.body.querySelectorAll('button, input, select');
    for (var i = 0; i < focusables.length; i++) if (focusables[i] === active) idx = i;
    if (force) dlg.title.textContent = T('set.title');
    clear(dlg.body);
    dlg.body.appendChild(settingsBody());
    dlg.body.scrollTop = scroll;
    if (idx >= 0) {
      var again = dlg.body.querySelectorAll('button, input, select')[idx];
      if (again) again.focus({ preventScroll: true });
    }
  }

  function sourceForm(type) {
    var dlg = S.settingsDialog;
    if (!dlg) return;
    dlg.form = type;
    var inputs = {};
    function input(key, label, kind, hint) {
      inputs[key] = h('input', { class: 'input', type: kind || 'text', autocomplete: 'off', autocapitalize: 'off',
                                 spellcheck: 'false' });
      return field(label, inputs[key], hint);
    }
    var fileText = null;
    var form = h('form', { class: 'source-form', novalidate: true });
    form.appendChild(h('p', { class: 'dlg-text', text: T('form.intro.' + type) }));
    form.appendChild(input('name', T('form.name')));
    if (type === 'm3u_url') form.appendChild(input('url', T('form.url'), 'url', T('form.urlHint')));
    if (type === 'xtream') {
      form.appendChild(input('server', T('form.server'), 'url', T('form.serverHint')));
      form.appendChild(input('username', T('form.username')));
      form.appendChild(input('password', T('form.password'), 'password'));
    }
    if (type === 'm3u_file') {
      var file = h('input', { class: 'input', type: 'file', accept: '.m3u,.m3u8,audio/x-mpegurl,application/x-mpegurl,text/plain',
                              onchange: function () {
                                var f = file.files && file.files[0];
                                if (!f) return;
                                if (!inputs.name.value) inputs.name.value = f.name.replace(/\.m3u8?$/i, '');
                                var reader = new FileReader();
                                reader.onload = function () { fileText = String(reader.result || ''); };
                                reader.readAsText(f);
                              } });
      form.appendChild(field(T('form.file'), file));
    }
    var error = h('p', { class: 'form-error', role: 'alert', hidden: true });
    form.appendChild(error);
    form.appendChild(h('p', { class: 'field-hint', text: T('form.privacy') }));
    function back() {
      dlg.form = null;
      setDialogBody(dlg, T('set.title'), settingsBody());
    }
    form.appendChild(h('div', { class: 'dlg-actions' }, [
      h('button', { class: 'btn', type: 'button', text: T('action.cancel'), onclick: back }),
      h('button', { class: 'btn btn-primary', type: 'submit', text: T('action.save') })
    ]));
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = {};
      Object.keys(inputs).forEach(function (k) { v[k] = inputs[k].value.trim(); });
      var missing = Object.keys(v).some(function (k) { return !v[k]; }) || (type === 'm3u_file' && fileText === null);
      if (missing) {
        error.textContent = T('form.missing');
        error.hidden = false;
        return;
      }
      if (type === 'm3u_url' && !sources.isWebUrl(v.url)) {
        error.textContent = T('form.badUrl');
        error.hidden = false;
        return;
      }
      if (type === 'm3u_url') addSource({ type: type, name: v.name, url: v.url });
      else if (type === 'xtream') addSource({ type: type, name: v.name, server: v.server, username: v.username,
                                              password: v.password });
      else addSource({ type: type, name: v.name }, fileText);
      toast(T('source.added', { name: v.name }));
      back();
    });
    setDialogBody(dlg, T('source.addTitle.' + type), form);
  }

  // --- keys -------------------------------------------------------------------------------------

  function isTextInput(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return true;
    return el.tagName === 'INPUT' && /^(text|search|url|password|email|number)$/i.test(el.type || 'text');
  }

  function exitApp() {
    if (root.PalmSystem && root.PalmSystem.platformBack) root.PalmSystem.platformBack();
  }

  function onKey(e) {
    var k = e.keyCode, el = document.activeElement, inText = isTextInput(el), top = topLayer();
    if (e.altKey || e.ctrlKey || e.metaKey) return;

    if (k === KEYS.BACK || k === KEYS.ESC) {
      if (k === KEYS.ESC && inText && el.value && el.id === 'search') {
        e.preventDefault();
        setSearch('');
      } else if (S.layers.length) {
        e.preventDefault();
        closeTop();
      } else if (k === KEYS.BACK) {
        e.preventDefault();
        if (S.search) setSearch('');
        else exitApp();
      }
      return;
    }

    if (top === 'full') {
      showOsd();
      if (!S.controlsVisible) {
        if (k === KEYS.UP || k === KEYS.CH_UP) { e.preventDefault(); zap(-1); return; }
        if (k === KEYS.DOWN || k === KEYS.CH_DOWN) { e.preventDefault(); zap(1); return; }
        if (k === KEYS.LEFT || k === KEYS.RIGHT || k === KEYS.ENTER) {
          e.preventDefault();
          showControls(true);
          return;
        }
      } else {
        showControls(false);
      }
    }

    if ((k === KEYS.CH_UP || k === KEYS.CH_DOWN) && !inText && S.current && !S.dialog) {
      e.preventDefault();
      zap(k === KEYS.CH_UP ? -1 : 1);
      return;
    }
    if (k === KEYS.PLAY || k === KEYS.PAUSE || k === KEYS.PLAY_PAUSE) {
      e.preventDefault();
      if (k === KEYS.PLAY && S.player.video.paused) S.player.resume();
      else if (k === KEYS.PAUSE && !S.player.video.paused) S.player.togglePause();
      else if (k === KEYS.PLAY_PAUSE) S.player.togglePause();
      return;
    }
    if (k === KEYS.STOP) { e.preventDefault(); stopPlayback(); return; }
    if (k === KEYS.RED && !S.dialog) {
      var row = el && el.closest && el.closest('.row');
      var key = row ? row.querySelector('.ch').getAttribute('data-key') : S.current && S.current.key;
      if (key && S.byKey[key]) toggleFav(S.byKey[key]);
      return;
    }
    if (k === KEYS.GREEN && !S.dialog && S.current) { toggleFull(); return; }
    if (k === KEYS.BLUE && !S.dialog) { openSettings(); return; }
    if (k === KEYS.YELLOW && !S.dialog) { nav.focus($('search')); return; }
    if (k === KEYS.INFO && S.full) { showControls(true); return; }

    if (nav.DIRS[k]) {
      if (nav.ownsArrow(el, k)) return;
      e.preventDefault();
      nav.move(nav.DIRS[k]);
      return;
    }
    if (inText) return;
    var ch = e.key && e.key.length === 1 ? e.key.toLowerCase() : '';
    if (ch === 'f' && S.current) { e.preventDefault(); toggleFull(); }
    else if (ch === 'm') { e.preventDefault(); toggleMute(); }
    else if (ch === '/') { e.preventDefault(); nav.focus($('search')); }
    else if (ch === ' ' && (!el || el === document.body || el.id === 'video')) { e.preventDefault(); S.player.togglePause(); }
  }

  function setSearch(value) {
    $('search').value = value;
    S.search = value;
    $('search-clear').hidden = !value;
    renderGroups();
    renderList();
    $('list-scroll').scrollTop = 0;
  }

  // --- start ------------------------------------------------------------------------------------

  function wire() {
    var searchTimer = null;
    $('search').addEventListener('input', function () {
      clearTimeout(searchTimer);
      var value = $('search').value;
      $('search-clear').hidden = !value;
      searchTimer = setTimeout(function () {
        S.search = value;
        renderGroups();
        renderList();
        $('list-scroll').scrollTop = 0;
      }, 150);
    });
    $('search').addEventListener('keydown', function (e) {
      if (e.keyCode === KEYS.ENTER) {
        e.preventDefault();
        var first = $('channel-list').querySelector('.ch');
        if (first) nav.focus(first);
      }
    });
    $('search-clear').addEventListener('click', function () { setSearch(''); nav.focus($('search')); });
    ['pointerdown', 'touchstart', 'wheel', 'scroll'].forEach(function (type) {
      $('list-scroll').addEventListener(type, function () { S.listTouched = Date.now(); }, { passive: true });
    });
    $('country').addEventListener('change', function () {
      S.country = $('country').value;
      renderList();
      $('list-scroll').scrollTop = 0;
    });
    $('btn-settings').addEventListener('click', openSettings);
    $('btn-check').addEventListener('click', checkVisible);

    $('b-play').addEventListener('click', function () {
      if (S.current) S.player.togglePause();
      else if (S.byKey[S.settings.lastChannel]) playChannel(S.byKey[S.settings.lastChannel], true);
    });
    $('b-prev').addEventListener('click', function () { zap(-1); });
    $('b-next').addEventListener('click', function () { zap(1); });
    $('b-fav').addEventListener('click', function () { if (S.current) toggleFav(S.current); });
    $('b-fit').addEventListener('click', pickFit);
    $('b-quality').addEventListener('click', pickQuality);
    $('b-mute').addEventListener('click', toggleMute);
    $('b-full').addEventListener('click', toggleFull);
    $('b-stop').addEventListener('click', stopPlayback);
    $('vol').addEventListener('input', function () {
      S.settings.volume = Number($('vol').value);
      S.settings.muted = S.settings.volume === 0;
      applyVolume();
    });
    $('vol').addEventListener('change', save);
    $('tap-play').addEventListener('click', function () {
      $('tap-play').hidden = true;
      S.player.resume();
    });

    var screen = $('screen');
    screen.addEventListener('dblclick', function () { if (!S.tv) toggleFull(); });
    screen.addEventListener('click', function (e) {
      if (e.target !== S.player.video && e.target !== screen) return;
      if (S.full) {
        if (S.controlsVisible && isTouch()) {
          clearTimeout(hideTimer);
          S.controlsVisible = false;
          $('stage').classList.add('controls-hidden');
        } else {
          showControls(false);
        }
      } else if (S.tv && S.current) {
        enterFull();
      }
    });
    $('stage').addEventListener('mousemove', function () { if (S.full) showControls(false); });

    document.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    root.addEventListener('popstate', function () { popLayer(); });

    // On a phone, turning it sideways while watching fills the screen with the picture.
    if (root.matchMedia) {
      var landscape = root.matchMedia('(orientation: landscape) and (max-height: 500px)');
      var onTurn = function () {
        if (S.tv || !isTouch()) return;
        if (landscape.matches && S.current && !S.full) enterFull(true);
        else if (!landscape.matches && S.full && S.fullAuto && topLayer() === 'full') closeTop();
      };
      if (landscape.addEventListener) landscape.addEventListener('change', onTurn);
      else if (landscape.addListener) landscape.addListener(onTurn);
      var light = root.matchMedia('(prefers-color-scheme: light)');
      var onScheme = function () { if (S.settings.theme === 'system') applyTheme(); };
      if (light.addEventListener) light.addEventListener('change', onScheme);
      else if (light.addListener) light.addListener(onScheme);
    }

    // A TV app is expected to stop playing when it's sent to the background, and pick up on return.
    document.addEventListener('visibilitychange', function () {
      if (!S.tv) return;
      if (document.hidden && S.current) {
        S.resumeOnShow = S.current;
        S.player.stop();
      } else if (!document.hidden && S.resumeOnShow) {
        var ch = S.resumeOnShow;
        S.resumeOnShow = null;
        if (S.current && S.current.key === ch.key) S.player.play(ch);
      }
    });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    var secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!secure) return;
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  function start() {
    S.settings = store.loadSettings();
    S.tv = detectTV();
    S.packaged = location.protocol === 'file:';
    CS.i18n.setLang(S.settings.lang);
    document.body.classList.toggle('tv', S.tv);
    document.documentElement.classList.toggle('tv', S.tv);
    applyTheme();
    S.group = GROUPS.indexOf(S.settings.lastGroup) >= 0 ? S.settings.lastGroup : 'Football';
    S.health = new health.HealthCache();
    S.player = new CS.player.Player($('video'), onPlayerEvent);
    S.player.buffer = S.settings.buffer;
    document.body.classList.toggle('no-volume', S.tv || isTouch());
    translatePage();
    wire();
    nav.init(scope, S.tv);
    applyVolume();
    updateNowPlaying();
    rebuild();
    renderIdle();
    setInterval(function () { S.player.tick(); }, 1000);
    loadFree();
    loadAllSources();
    registerServiceWorker();
  }

  CS.app = { start: start, state: S };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(this);
