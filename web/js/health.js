/* Quick 'is this channel alive?' check, so dead links are marked before you click them.
 *
 * A port of clearstream/health.py. One difference a browser forces on us: a page may only read a
 * stream if its server allows it (CORS). A stream that refuses is reported as 'nocors': the TV's and
 * Safari's built-in players can still show it, but hls.js (used by Chrome, Edge and Firefox) can't.
 */
(function (root) {
  'use strict';
  var CS = root.CS = root.CS || {};
  var sources = CS.sources;

  var TTL = 6 * 3600 * 1000;
  var STALE_MINUTES = 30;
  var CACHE_KEY = 'cs.health.v1';
  var HLS_TYPES = ['mpegurl', 'video/', 'audio/', 'octet-stream', 'mp2t'];

  /** A short, non-reversible key, so private addresses aren't stored in readable form. */
  function hashKey(str) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
  }

  class HealthCache {
    constructor() {
      this.data = CS.store ? CS.store.getJSON(CACHE_KEY, {}) : {};
      this.dirty = false;
    }

    get(url) {
      var e = this.data[hashKey(url)];
      return e && Date.now() - e.t < TTL ? e.s : null;
    }

    put(url, status) {
      this.data[hashKey(url)] = { s: status, t: Date.now() };
      this.dirty = true;
    }

    save() {
      if (!this.dirty || !CS.store) return;
      var now = Date.now(), keep = {}, data = this.data;
      Object.keys(data).forEach(function (k) { if (now - data[k].t < TTL) keep[k] = data[k]; });
      this.data = keep;
      CS.store.setJSON(CACHE_KEY, keep);
      this.dirty = false;
    }

    apply(channels) {
      var self = this;
      channels.forEach(function (ch) {
        ch.streams.forEach(function (s) { s.status = self.get(s.url) || 'unknown'; });
      });
    }
  }

  // --- probing ------------------------------------------------------------------------------------

  class Unreadable extends Error {}

  function startsWith(bytes, text) {
    var i = 0;
    while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a ||
                                 bytes[i] === 0x0d || bytes[i] === 0xef || bytes[i] === 0xbb || bytes[i] === 0xbf)) {
      i++;
    }
    for (var j = 0; j < text.length; j++) {
      if (bytes[i + j] !== text.charCodeAt(j)) return false;
    }
    return true;
  }

  /** Fetch the first `limit` bytes. Throws Unreadable when the browser can't read the answer at all. */
  async function head(url, limit, timeout) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeout);
    try {
      var r;
      try {
        r = await fetch(url, { credentials: 'omit', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
      } catch (e) {
        if (e && e.name === 'AbortError') return null;
        throw new Unreadable(String(e));
      }
      if (!r.ok) return null;
      var bytes;
      if (r.body && r.body.getReader) {
        var reader = r.body.getReader(), parts = [], got = 0;
        while (got < limit) {
          var chunk = await reader.read();
          if (chunk.done) break;
          parts.push(chunk.value);
          got += chunk.value.length;
        }
        reader.cancel().catch(function () {});
        bytes = new Uint8Array(Math.min(got, limit));
        var at = 0;
        for (var i = 0; i < parts.length && at < bytes.length; i++) {
          var part = parts[i].subarray(0, bytes.length - at);
          bytes.set(part, at);
          at += part.length;
        }
      } else {
        bytes = new Uint8Array(await r.arrayBuffer()).subarray(0, limit);
      }
      return { url: r.url || url, type: (r.headers.get('Content-Type') || '').toLowerCase(), bytes: bytes };
    } catch (e) {
      if (e instanceof Unreadable) throw e;
      return null;                       // aborted mid-read or the connection broke
    } finally {
      clearTimeout(timer);
    }
  }

  function text(bytes) {
    return typeof TextDecoder === 'function' ? new TextDecoder('utf-8').decode(bytes)
      : String.fromCharCode.apply(null, bytes.subarray(0, 65536));
  }

  function looksLikeVideo(res) {
    if (startsWith(res.bytes, '#EXTM3U')) return true;
    if (res.bytes[0] === 0x47) return true;       // MPEG-TS sync byte
    return HLS_TYPES.some(function (t) { return res.type.indexOf(t) >= 0; }) && !startsWith(res.bytes, '<');
  }

  /** A live playlist whose newest timestamp is old has frozen: it answers, but never plays. */
  function freshMediaPlaylist(body) {
    if (body.indexOf('#EXTINF') < 0 || body.indexOf('#EXT-X-ENDLIST') >= 0) return true;
    var stamps = body.match(/#EXT-X-PROGRAM-DATE-TIME:\s*\S+/g);
    if (!stamps) return true;
    var newest = Date.parse(stamps[stamps.length - 1].replace(/#EXT-X-PROGRAM-DATE-TIME:\s*/, ''));
    if (isNaN(newest)) return true;
    return Date.now() - newest < STALE_MINUTES * 60000;
  }

  function resolve(base, ref) {
    try { return new URL(ref, base).href; } catch (e) { return ''; }
  }

  /** Geo-blocking is usually enforced on the video pieces, not the playlist, so fetch the newest one. */
  async function segmentOk(playlistUrl, body, timeout) {
    var uris = body.split(/\r?\n/).map(function (l) { return l.trim(); })
      .filter(function (l) { return l && l[0] !== '#'; });
    if (!uris.length) return false;
    var res = await head(resolve(playlistUrl, uris[uris.length - 1]), 2048, timeout);
    return !!res && res.bytes.length > 0 && !startsWith(res.bytes, '<');
  }

  async function mediaOk(url, body, timeout) {
    if (body.indexOf('#EXTINF') < 0) return true;
    return freshMediaPlaylist(body) && await segmentOk(url, body, timeout);
  }

  async function probeReadable(url, timeout) {
    var res = await head(url, 65536, timeout);
    if (!res || !looksLikeVideo(res)) return false;
    var body = text(res.bytes);
    if (body.indexOf('#EXT-X-STREAM-INF') < 0) return mediaOk(res.url, body, timeout);
    // A master playlist can be served while every quality behind it is dead; check the first one.
    var lines = body.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('#EXT-X-STREAM-INF') !== 0) continue;
      var variant = '';
      for (var j = i + 1; j < lines.length && !variant; j++) {
        var l = lines[j].trim();
        if (l && l[0] !== '#') variant = l;
      }
      if (!variant) return false;
      var sub = await head(resolve(res.url, variant), 65536, timeout);
      if (!sub || !startsWith(sub.bytes, '#EXTM3U')) return false;
      return mediaOk(sub.url, text(sub.bytes), timeout);
    }
    return true;
  }

  /** 'ok', 'dead', or 'nocors' (the server answers, but won't let a web page read the stream). */
  async function probe(url, timeout) {
    try {
      return (await probeReadable(url, timeout || 8000)) ? 'ok' : 'dead';
    } catch (e) {
      if (!(e instanceof Unreadable)) return 'dead';
    }
    try {   // an opaque request still tells us whether anything answered at all
      await sources.fetchWithTimeout(url, { mode: 'no-cors', credentials: 'omit', cache: 'no-store' }, timeout || 8000);
      return 'nocors';
    } catch (e) {
      return 'dead';
    }
  }

  /** Probe one stream; an http:// address is tried as https:// first and kept if that works. */
  async function checkStream(stream, nativeHls) {
    var verdict;
    if (stream.url.toLowerCase().indexOf('http://') === 0) {
      var secure = 'https://' + stream.url.slice(7);
      verdict = await probe(secure, 5000);
      if (verdict === 'ok') {
        stream.url = secure;
        return 'ok';
      }
      if (!sources.httpAllowedHere()) return nativeHls && verdict === 'nocors' ? 'unknown' : 'dead';
    }
    verdict = await probe(stream.url, 8000);
    if (verdict === 'nocors') return nativeHls ? 'unknown' : 'dead';
    return verdict;
  }

  /** progress(done, total, channel) is called after each channel; set cancel.cancelled to stop. */
  async function checkChannels(channels, cache, opts) {
    var todo = channels.slice(), total = todo.length, done = 0;
    async function worker() {
      while (todo.length && !opts.cancel.cancelled) {
        var ch = todo.shift();
        for (var i = 0; i < ch.streams.length && !opts.cancel.cancelled; i++) {
          var s = ch.streams[i];
          try {
            s.status = await checkStream(s, opts.nativeHls);
          } catch (e) {
            s.status = 'dead';
          }
          if (s.status !== 'unknown') cache.put(s.url, s.status);
        }
        done++;
        opts.progress(done, total, ch);
        if (done % 25 === 0) cache.save();
      }
    }
    var workers = [];
    for (var w = 0; w < Math.min(opts.workers, total); w++) workers.push(worker());
    await Promise.all(workers);
    cache.save();
  }

  CS.health = { HealthCache: HealthCache, checkChannels: checkChannels, checkStream: checkStream,
                freshMediaPlaylist: freshMediaPlaylist, hashKey: hashKey };
})(this);
