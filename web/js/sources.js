/* Channel sources: the curated free list (iptv-org, strictly filtered) and the user's own paid playlists.
 *
 * A straight port of clearstream/sources.py, so the web app shows exactly the channels the Windows app
 * shows. Nothing in a playlist is ever executed: we read names, a few known attributes and http(s)
 * stream addresses; every other line is ignored.
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.CS = root.CS || {}).sources = mod;
})(this, function () {
  'use strict';

  var IPTV_ORG_API = ['https://iptv-org.github.io/api/', 'https://raw.githubusercontent.com/iptv-org/api/gh-pages/'];
  var SPORT_GROUPS = ['Football', 'Tennis', 'Cricket'];

  // Python's \b and \w are Unicode-aware; JavaScript's are ASCII-only. Rebuild them from Unicode classes
  // so names such as "Fútbol" split into words the same way. Older TVs without lookbehind fall back.
  var WORD = '[\\p{L}\\p{N}_]';
  var UNICODE_B = '(?:(?<=' + WORD + ')(?!' + WORD + ')|(?<!' + WORD + ')(?=' + WORD + '))';

  function rx(source) {
    try {
      return new RegExp(source.replace(/\\b/g, UNICODE_B), 'iu');
    } catch (e) {
      return new RegExp(source, 'i');
    }
  }

  var NON_WORD = (function () {
    try { return new RegExp('[^\\p{L}\\p{N}_]+', 'gu'); } catch (e) { return /[^\w]+/g; }
  })();

  // --- Grouping ---------------------------------------------------------------------------------

  var FOOTBALL = rx('football|soccer|f[uú]tbol|fifa|golazo|\\bbein\\b|la ?liga|premier league|\\bepl\\b|' +
                    'uefa|serie a|bundesliga|ligue 1|\\bmls\\b|\\bmutv\\b|\\blfc\\b|talksport|\\bgoal');
  var TENNIS = rx('tennis|\\batp\\b|\\bwta\\b|wimbledon|roland.?garros|\\bus open\\b');
  var CRICKET = rx('cricket|willow|\\bipl\\b|\\bpsl\\b|\\bbpl\\b|\\bicc\\b|\\bashes\\b|\\bt20\\b');
  var NEWS = rx('\\bnews\\b|\\bcnn\\b|al ?jazeera|al arabiya|\\bndtv\\b|\\bwion\\b|aaj tak|samachar|khabar|' +
                'bloomberg|\\bcnbc\\b|c-?span|france ?24|euronews|\\bdw\\b');
  var SPORT = rx('sport|\\bespn\\b|\\bnfl\\b|\\bnba\\b|\\bnhl\\b|\\bmlb\\b|golf|racing|\\bf1\\b|motor|boxing|' +
                 '\\bufc\\b|\\bmma\\b|\\bwwe\\b|\\bdazn\\b|\\btnt\\b|\\bpga\\b|rugby|kabaddi');
  var SPECIFIC = [['Football', FOOTBALL], ['Tennis', TENNIS], ['Cricket', CRICKET]];

  // National sports channels that carry cricket without saying so in their name.
  var EXTRA_GROUPS = { 'DDSports.in': ['Cricket'], 'PTVSports.pk': ['Cricket'], 'TSports.bd': ['Cricket', 'Football'] };

  function classify(text, news, sports) {
    var groups = [];
    if (news || NEWS.test(text)) groups.push('News');
    SPECIFIC.forEach(function (pair) {
      if (pair[1].test(text)) groups.push(pair[0]);
    });
    if ((sports || SPORT.test(text)) && !hasSportGroup(groups)) groups.push('Sports');
    return groups.length ? groups : ['Other'];
  }

  function hasSportGroup(groups) {
    return groups.some(function (g) { return SPORT_GROUPS.indexOf(g) >= 0; });
  }

  // --- Legitimacy filter for the free list (see sources.py for the reasoning) --------------------

  var BLOCKED_HOSTS = [
    'jmp2.uk', 'mjh.nz', 'githubusercontent.com', 'github.io', 'onrender.com', 'herokuapp.com',
    'workers.dev', 'pages.dev', 'glitch.me', 'dpdns.org', 'ngrok.io', 'aynascope.net', 'aynaott.com',
    'bozztv.com', 'stmify.com', 'rezofoot.tv', 'mcquack.net', 'iptvperu.tv', 'boldmss.com',
    'nellaiiptv.com', 'cc.cd', 'playstop.me', 'siauliairsavlt.pw', 'rabta.stream', 'thelegitpro.in',
    'livelegitpro.in', 'jswk.online', 'gpcdn.net'
  ];
  var TRUSTED_SPORTS_HOSTS = [
    'amagi.tv', 'wurl.com', 'wurl.tv', 'tubi.video', 'tubi.io', 'cbsivideo.com', 'dai.google.com',
    'nbcuni.com', 'brightcove.com', 'akamaized.net', 'akamaihd.net', 'cloudfront.net', 'mangomolo.com',
    'mgmlcdn.com', 'frequency.stream', 'getpublica.com', 'klowdtv.com', 'sofast.tv', 'amazonaws.com',
    'zype.com', 'transmit.live', 'uplynk.com', 'streamlock.net', 'wowza.com', 'cdn77.org',
    'vgcdn.net', 'itworkscdn.net', 'streamhoster.com'
  ];
  var PAY_TV = rx(
    '\\bsky sports\\b|\\bbein sports(?! xtra)\\b|star sports|sony (sports|ten|six)|\\bten (sports|cricket)\\b|' +
    '\\bespn(?!8)|fox sports [12]\\b|\\bfs1\\b|nfl network|nba tv|\\bmsg\\b|usa network|wwe network|setanta|' +
    'dsports|tnt sports|\\bbt sport|eurosport|\\bdazn(?! combat)|^willow( hd)?$|\\bmutv\\b|supersport|' +
    'sportsnet|\\btsn\\b|fox deportes|golf channel|premier sports|viaplay|unite8|^m sports$|one golf|' +
    '^pk sports$|^t sports$|ptv sports|ad sports|abu dhabi sports|\\bssc\\b|kayo|optus sport');

  function parseUrl(url) {
    try { return new URL(url); } catch (e) { return null; }
  }

  function isWebUrl(url) {
    var u = parseUrl(url);
    return !!u && (u.protocol === 'http:' || u.protocol === 'https:') && !!u.host;
  }

  function hostOf(url) {
    var u = parseUrl(url);
    return u ? u.hostname.toLowerCase() : '';
  }

  function hostMatches(host, suffixes) {
    return suffixes.some(function (s) { return host === s || host.slice(-(s.length + 1)) === '.' + s; });
  }

  function isIp(host) {
    var h = host.replace(/^\[|\]$/g, '');
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.indexOf(':') >= 0;
  }

  function freeStreamAllowed(name, isSports, url) {
    if (url.toLowerCase().indexOf('https://') !== 0) return false;
    var host = hostOf(url);
    if (!host || isIp(host) || hostMatches(host, BLOCKED_HOSTS)) return false;
    if (PAY_TV.test(name)) return false;
    if (isSports && !hostMatches(host, TRUSTED_SPORTS_HOSTS)) return false;
    return true;
  }

  // --- Small helpers ------------------------------------------------------------------------------

  function stableSort(list, key) {     // Array#sort is not stable on the Chromium in 2020 LG TVs
    return list.map(function (item, i) { return [key(item), i, item]; })
      .sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]; })
      .map(function (x) { return x[2]; });
  }

  function makeStream(url, userAgent, referrer, note) {
    return { url: url, userAgent: userAgent || '', referrer: referrer || '', note: note || '', status: 'unknown' };
  }

  function channelStatus(ch) {
    var ok = false, allDead = ch.streams.length > 0;
    ch.streams.forEach(function (s) {
      if (s.status === 'ok') ok = true;
      if (s.status !== 'dead') allDead = false;
    });
    return ok ? 'ok' : allDead ? 'dead' : 'unknown';
  }

  var STREAM_RANK = { ok: 0, unknown: 1, dead: 2 };

  function orderedStreams(ch) {
    return stableSort(ch.streams, function (s) { return STREAM_RANK[s.status]; });
  }

  // --- Free list (iptv-org public API) -----------------------------------------------------------

  /** Pure part of load_free_channels: the three iptv-org lists in, the filtered channels out. */
  function buildFreeChannels(channels, streams, blocklist, countries) {
    var blocked = {};
    blocklist.forEach(function (b) { blocked[b.channel] = true; });
    var wanted = {};
    countries.forEach(function (c) { wanted[c] = true; });
    var byId = {};
    channels.forEach(function (c) {
      var cats = c.categories || [];
      if (wanted[c.country] && !c.is_nsfw && !c.closed && !blocked[c.id] &&
          (cats.indexOf('news') >= 0 || cats.indexOf('sports') >= 0)) {
        byId[c.id] = c;
      }
    });

    var result = {}, order = [];
    streams.forEach(function (s) {
      var c = s.channel ? byId[s.channel] : null;
      var url = (s.url || '').trim();
      if (!c || !isWebUrl(url)) return;
      var cats = c.categories || [];
      var name = c.name || c.id;
      if (!freeStreamAllowed(name, cats.indexOf('sports') >= 0, url)) return;
      var ch = result[c.id];
      if (!ch) {
        var text = [name].concat(c.alt_names || []).join(' ');
        var groups = classify(text, cats.indexOf('news') >= 0, cats.indexOf('sports') >= 0);
        (EXTRA_GROUPS[c.id] || []).forEach(function (g) { if (groups.indexOf(g) < 0) groups.push(g); });
        if (hasSportGroup(groups)) groups = groups.filter(function (g) { return g !== 'Sports'; });
        groups = groups.filter(function (g) { return g !== 'Other'; });
        ch = result[c.id] = { key: 'free:' + c.id, name: name, country: c.country, groups: groups,
                              source: 'Free (iptv-org)', free: true, epgId: c.id, logo: '', streams: [] };
        order.push(c.id);
      }
      if (ch.streams.some(function (x) { return x.url === url; })) return;
      ch.streams.push(makeStream(url, s.user_agent, s.referrer, (s.labels || []).join(', ')));
    });
    return order.map(function (id) {   // streams the list already flags as geo-blocked go last
      var ch = result[id];
      ch.streams = stableSort(ch.streams, function (x) { return x.note.indexOf('Geo-blocked') >= 0 ? 1 : 0; });
      return ch;
    });
  }

  /** The best logo per channel: a main-feed logo that's in use, over https (http would be blocked). */
  function pickLogos(logos, wantedIds) {
    var best = {};
    logos.forEach(function (l) {
      if (!wantedIds[l.channel] || !l.url || l.url.indexOf('https://') !== 0) return;
      var score = (l.feed ? 0 : 2) + (l.in_use ? 1 : 0);
      var cur = best[l.channel];
      if (!cur || score > cur.score) best[l.channel] = { score: score, url: l.url };
    });
    var out = {};
    Object.keys(best).forEach(function (id) { out[id] = best[id].url; });
    return out;
  }

  function fetchWithTimeout(url, options, ms) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var opts = Object.assign({}, options || {});
    if (ctrl) opts.signal = ctrl.signal;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms);
    return fetch(url, opts).then(function (r) {
      clearTimeout(timer);
      return r;
    }, function (e) {
      clearTimeout(timer);
      throw e;
    });
  }

  /** Download one iptv-org list, trying the second address if the first is unreachable. */
  async function iptvOrg(name) {
    var last;
    for (var i = 0; i < IPTV_ORG_API.length; i++) {
      try {
        var r = await fetchWithTimeout(IPTV_ORG_API[i] + name + '.json', { credentials: 'omit' }, 90000);
        if (!r.ok) throw new Error('server answered ' + r.status);
        return await r.json();
      } catch (e) {
        last = e;
      }
    }
    throw last;
  }

  async function loadFreeChannels(countries) {
    var lists = await Promise.all([iptvOrg('channels'), iptvOrg('streams'), iptvOrg('blocklist')]);
    return buildFreeChannels(lists[0], lists[1], lists[2], countries);
  }

  async function loadFreeLogos(channels) {
    var ids = {};
    channels.forEach(function (ch) { ids[ch.epgId] = true; });
    return pickLogos(await iptvOrg('logos'), ids);
  }

  // --- The user's own playlists -------------------------------------------------------------------

  var ATTR = /([\w-]+)="([^"]*)"/g;
  var NOISE = rx('\\(.*?\\)|\\[.*?\\]|\\b(f?hd|uhd|sd|4k|hevc|h\\.?26[45]|\\d{3,4}p|\\d+fps|backup|alt|vip|raw)\\b');
  var NOISE_ALL = new RegExp(NOISE.source, NOISE.flags + 'g');
  var ALLOWED_VLC_OPTS = { 'http-user-agent': 'userAgent', 'http-referrer': 'referrer', 'http-referer': 'referrer' };

  function norm(name) {
    var s = name.toLowerCase().replace(NOISE_ALL, ' ').replace(NON_WORD, ' ');
    s = s.split(/\s+/).filter(Boolean).join(' ');
    return s || name.toLowerCase();
  }

  function attrs(text) {
    var out = {}, m;
    ATTR.lastIndex = 0;
    while ((m = ATTR.exec(text)) !== null) out[m[1].toLowerCase()] = m[2];
    return out;
  }

  function splitExtinf(line) {
    var body = line.slice('#EXTINF:'.length), quoted = false;
    for (var i = 0; i < body.length; i++) {
      if (body[i] === '"') quoted = !quoted;
      else if (body[i] === ',' && !quoted) return [body.slice(0, i), body.slice(i + 1).trim()];
    }
    return [body, ''];
  }

  function addStream(channels, order, key, name, country, groups, sourceName, epgId, logo, stream) {
    var ch = channels[key];
    if (!ch) {
      ch = channels[key] = { key: key, name: name, country: country, groups: groups, source: sourceName,
                             free: false, epgId: epgId, logo: logo || '', streams: [] };
      order.push(key);
    }
    if (!ch.epgId && epgId) ch.epgId = epgId;
    if (!ch.logo && logo) ch.logo = logo;
    if (!ch.streams.some(function (x) { return x.url === stream.url; })) ch.streams.push(stream);
  }

  /** Returns {channels, epgUrls}. */
  function parseM3U(text, sourceId, sourceName) {
    var channels = {}, order = [], epgUrls = [];
    var pending = null, opts = {}, extgrp = '';
    text.split(/\r\n|\r|\n/).forEach(function (raw) {
      var line = raw.trim().replace(/^﻿/, '');
      if (!line) return;
      if (line.indexOf('#EXTM3U') === 0) {
        var head = attrs(line);
        ['x-tvg-url', 'url-tvg'].forEach(function (k) {
          if (!head[k]) return;
          head[k].split(',').forEach(function (u) { if (isWebUrl(u.trim())) epgUrls.push(u.trim()); });
        });
      } else if (line.indexOf('#EXTINF') === 0) {
        var parts = splitExtinf(line), a = attrs(parts[0]);
        pending = { name: parts[1] || a['tvg-name'] || 'Unnamed', attrs: a };
        opts = {};
        extgrp = '';
      } else if (line.indexOf('#EXTVLCOPT:') === 0) {
        var kv = line.slice('#EXTVLCOPT:'.length), eq = kv.indexOf('=');
        var field = ALLOWED_VLC_OPTS[(eq >= 0 ? kv.slice(0, eq) : kv).trim().toLowerCase()];
        if (field) opts[field] = eq >= 0 ? kv.slice(eq + 1).trim() : '';   // every other option is ignored
      } else if (line.indexOf('#EXTGRP:') === 0) {
        extgrp = line.slice('#EXTGRP:'.length).trim();
      } else if (line[0] === '#') {
        return;
      } else {
        if (!pending) return;
        var p = pending;
        pending = null;
        if (!isWebUrl(line) || /\/(movie|series)\//i.test(line)) return;
        var groupTitle = p.attrs['group-title'] || extgrp;
        var country = (p.attrs['tvg-country'] || '').slice(0, 2).toUpperCase();
        var logo = (p.attrs['tvg-logo'] || '').trim();
        addStream(channels, order, sourceId + ':' + norm(p.name), p.name, country,
                  classify(p.name + ' ' + groupTitle), sourceName, (p.attrs['tvg-id'] || '').trim(),
                  logo.indexOf('https://') === 0 ? logo : '',
                  makeStream(line, opts.userAgent, opts.referrer));
      }
    });
    return { channels: order.map(function (k) { return channels[k]; }), epgUrls: epgUrls };
  }

  /** Addresses to try, encrypted first: https://x, then the original http://x. */
  function httpsFirst(url) {
    if (url.toLowerCase().indexOf('http://') === 0) return ['https://' + url.slice(7), url];
    return [url];
  }

  /** A browser on an https page refuses plain http (mixed content), so don't even try it there. */
  function httpAllowedHere() {
    return typeof location === 'undefined' || location.protocol !== 'https:';
  }

  function candidates(url) {
    return httpsFirst(url).filter(function (u) {
      return u.indexOf('https://') === 0 || httpAllowedHere();
    });
  }

  function describe(e) {
    if (e && e.name === 'AbortError') return 'timeout';
    return (e && e.message) || String(e);
  }

  class SourceError extends Error {
    constructor(code, detail) {
      super(code + (detail ? ': ' + detail : ''));
      this.code = code;          // translated by the UI
      this.detail = detail || '';
    }
  }

  async function fetchText(url) {
    var r = await fetchWithTimeout(url, { credentials: 'omit' }, 60000);
    if (!r.ok) throw new Error('server answered ' + r.status);
    return await r.text();
  }

  async function loadM3UUrl(src) {
    var urls = candidates(src.url), last;
    if (!urls.length) throw new SourceError('http_blocked');
    for (var i = 0; i < urls.length; i++) {
      try {
        var parsed = parseM3U(await fetchText(urls[i]), src.id, src.name);
        return { channels: parsed.channels, secure: urls[i].indexOf('https://') === 0 };
      } catch (e) {
        last = e;
      }
    }
    throw new SourceError(last instanceof TypeError ? 'unreachable' : 'download_failed', describe(last));
  }

  function xtreamBase(server) {
    var s = server.trim().replace(/\/+$/, '');
    if (s.indexOf('://') < 0) s = 'http://' + s;
    var u = parseUrl(s);
    if (!u) throw new SourceError('bad_address');
    return u.protocol + '//' + u.host;
  }

  async function loadXtream(src) {
    var qs = 'username=' + encodeURIComponent(src.username) + '&password=' + encodeURIComponent(src.password);
    var base = null, last;
    var tries = candidates(xtreamBase(src.server));
    if (!tries.length) throw new SourceError('http_blocked');
    for (var i = 0; i < tries.length && !base; i++) {
      try {
        var info = JSON.parse(await fetchText(tries[i] + '/player_api.php?' + qs));
        if (String((info && info.user_info || {}).auth) !== '1') {
          last = new SourceError('login_rejected');
          continue;
        }
        base = tries[i];
      } catch (e) {
        last = e;
      }
    }
    if (!base) {
      if (last instanceof SourceError) throw last;
      throw new SourceError(last instanceof TypeError ? 'unreachable' : 'login_failed', describe(last));
    }

    async function api(action) {
      var data = JSON.parse(await fetchText(base + '/player_api.php?' + qs + '&action=' + action));
      return Array.isArray(data) ? data : [];
    }

    var categories = {};
    (await api('get_live_categories')).forEach(function (c) {
      categories[String(c.category_id)] = c.category_name || '';
    });
    var u = encodeURIComponent(src.username), p = encodeURIComponent(src.password);
    var channels = {}, order = [];
    (await api('get_live_streams')).forEach(function (item) {
      var sid = String(item.stream_id || ''), name = String(item.name || '').trim();
      if (!/^\d+$/.test(sid) || !name) return;
      var groups = classify(name + ' ' + (categories[String(item.category_id)] || ''));
      var key = src.id + ':' + norm(name), stem = base + '/live/' + u + '/' + p + '/' + sid;
      var icon = String(item.stream_icon || '');
      var logo = icon.indexOf('https://') === 0 ? icon : '';
      var epg = String(item.epg_channel_id || '');
      addStream(channels, order, key, name, '', groups, src.name, epg, logo, makeStream(stem + '.m3u8'));
      addStream(channels, order, key, name, '', groups, src.name, epg, logo, makeStream(stem + '.ts', '', '', 'TS'));
    });
    return { channels: order.map(function (k) { return channels[k]; }), secure: base.indexOf('https://') === 0 };
  }

  /** Returns {channels, secure}. File sources keep their parsed text with them. */
  async function loadUserSource(src) {
    if (src.type === 'm3u_file') {
      return { channels: parseM3U(src.text || '', src.id, src.name).channels, secure: true };
    }
    if (src.type === 'm3u_url') return loadM3UUrl(src);
    if (src.type === 'xtream') return loadXtream(src);
    throw new SourceError('unknown_type', src.type);
  }

  return {
    SPORT_GROUPS: SPORT_GROUPS,
    classify: classify,
    freeStreamAllowed: freeStreamAllowed,
    isWebUrl: isWebUrl,
    hostOf: hostOf,
    httpsFirst: httpsFirst,
    httpAllowedHere: httpAllowedHere,
    fetchWithTimeout: fetchWithTimeout,
    stableSort: stableSort,
    channelStatus: channelStatus,
    orderedStreams: orderedStreams,
    buildFreeChannels: buildFreeChannels,
    pickLogos: pickLogos,
    iptvOrg: iptvOrg,
    loadFreeChannels: loadFreeChannels,
    loadFreeLogos: loadFreeLogos,
    parseM3U: parseM3U,
    norm: norm,
    loadUserSource: loadUserSource,
    SourceError: SourceError
  };
});
