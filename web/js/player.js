/* Playback with buffering, automatic reconnect and automatic switch to backup streams.
 *
 * A port of clearstream/player.py from libVLC to the browser's <video> element. HLS is played by
 * hls.js where the browser supports Media Source Extensions (Chrome, Edge, Firefox, Android), and by the
 * browser's own player where that's the better choice (Safari, iPhone/iPad, LG webOS TVs).
 */
(function (root) {
  'use strict';
  var CS = root.CS = root.CS || {};
  var sources = CS.sources;

  var RETRY_DELAYS = [2, 5, 10];   // waits before reconnecting a stream that was playing and dropped
  var START_RETRY_DELAYS = [2];    // a stream that never started gets one quick retry, then the backup
  var KEEP_TRYING_SECONDS = 180;   // once a channel has played, keep reconnecting through an outage this long
  var STALL_SECONDS = 15;          // playing but the picture hasn't moved for this long = dropped
  var OPEN_TIMEOUT = 25;           // still opening/buffering after this long = failed
  var STABLE_SECONDS = 30;         // after this much smooth playback, the retry budget resets

  // Picture shapes. "auto" fixes standard-definition widescreen sent without its 16:9 flag
  // (it arrives as 720x576 or 720x480 and would otherwise look squashed with side bars).
  var FITS = ['auto', 'contain', 'cover', 'fill'];
  var SD_SIZES = ['720x576', '704x576', '720x480', '704x480', '544x576', '480x576'];

  // How far behind live hls.js stays, and how much it keeps in reserve, per buffer setting.
  var BUFFERS = {
    short: { liveSyncDurationCount: 2, maxBufferLength: 10, maxMaxBufferLength: 30 },
    normal: { liveSyncDurationCount: 3, maxBufferLength: 30, maxMaxBufferLength: 60 },
    long: { liveSyncDurationCount: 5, maxBufferLength: 60, maxMaxBufferLength: 120 }
  };

  function now() {
    return (root.performance && performance.now ? performance.now() : Date.now()) / 1000;
  }

  function detect(video) {
    var ua = (root.navigator && navigator.userAgent) || '';
    var nativeHls = !!video.canPlayType('application/vnd.apple.mpegurl') ||
                    !!video.canPlayType('application/x-mpegURL');
    var webos = /Web0S|webOS|NetCast/i.test(ua);
    var apple = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && /Version\/[\d.]+.*Safari/.test(ua));
    var Hls = root.Hls;
    var mse = !!(Hls && Hls.isSupported && Hls.isSupported());
    return {
      webos: webos,
      nativeHls: nativeHls,
      nativeTs: !!video.canPlayType('video/mp2t'),
      hlsjs: mse,
      // The TV's and Apple's own players are hardware-accelerated and don't need the stream's
      // permission (CORS), so they go first there. Everywhere else hls.js is the reliable choice.
      preferNative: nativeHls && (webos || apple || !mse)
    };
  }

  class Player {
    /** onEvent(kind, info, channel, stream) */
    constructor(video, onEvent) {
      this.video = video;
      this.onEvent = onEvent;
      this.caps = detect(video);
      this.buffer = 'normal';
      this.fit = 'auto';
      this.hls = null;
      this.engine = null;
      this.channel = null;
      this.streams = [];
      this.userPaused = false;
      this._resetState();
      var self = this;
      video.addEventListener('timeupdate', function () { self._progress(); });
      video.addEventListener('loadedmetadata', function () { self.applyFit(); });
      video.addEventListener('resize', function () { self.applyFit(); });
      video.addEventListener('error', function () {
        if (self.engine === 'native' && self.channel) self._fail('error');
      });
      video.addEventListener('pause', function () { self._emitState(); });
      video.addEventListener('play', function () { self._emitState(); });
    }

    _resetState() {
      this.idx = 0;
      this.retries = 0;
      this.retryAt = null;
      this.openedAt = 0;
      this.lastProgress = 0;
      this.lastTime = null;
      this.advances = 0;
      this.playingReported = false;
      this.playedThisSession = false;   // any stream of this channel played since you pressed play
      this.streamPlayed = false;        // the current stream played
      this.troubleSince = null;
      this.unsupported = 0;
      this.waitingForTap = false;
    }

    // --- public ---------------------------------------------------------------------------------

    play(channel) {
      this.stop();
      this.channel = channel;
      this.streams = sources.orderedStreams(channel);
      this._resetState();
      this.userPaused = false;
      if (!this.streams.length) {
        this.channel = null;
        this.onEvent('failed', { noStreams: true }, channel, null);
        return;
      }
      this._open();
    }

    stop() {
      this.channel = null;
      this.retryAt = null;
      this._teardown();
    }

    retry() {
      if (this.channel) this.play(this.channel);
    }

    /** After the browser refused to start sound without a tap, the tap lands here. */
    resume() {
      this.userPaused = false;
      this.waitingForTap = false;
      this.lastProgress = now();
      var p = this.video.play();
      if (p && p.catch) p.catch(function () {});
    }

    togglePause() {
      if (!this.channel) return;
      if (this.video.paused) {
        this.resume();
      } else {
        this.userPaused = true;
        this.video.pause();
      }
    }

    setFit(fit) {
      this.fit = FITS.indexOf(fit) >= 0 ? fit : 'auto';
      this.applyFit();
    }

    applyFit() {
      var v = this.video, fit = this.fit;
      if (fit === 'auto') fit = SD_SIZES.indexOf(v.videoWidth + 'x' + v.videoHeight) >= 0 ? 'fill' : 'contain';
      v.style.objectFit = fit;
    }

    /** Quality choices hls.js found in the stream: [{index, height, bitrate}], -1 = automatic. */
    levels() {
      if (!this.hls || !this.hls.levels) return [];
      return this.hls.levels.map(function (l, i) { return { index: i, height: l.height || 0, bitrate: l.bitrate || 0 }; });
    }

    currentLevel() {
      return this.hls ? (this.hls.autoLevelEnabled ? -1 : this.hls.currentLevel) : -1;
    }

    setLevel(index) {
      if (this.hls) this.hls.currentLevel = index;
    }

    // --- internals ------------------------------------------------------------------------------

    _teardown() {
      if (this.hls) {
        try { this.hls.destroy(); } catch (e) { /* already gone */ }
        this.hls = null;
      }
      this.engine = null;
      var v = this.video;
      try {
        v.pause();
        v.removeAttribute('src');
        v.load();
      } catch (e) { /* nothing was loaded */ }
    }

    _url(stream) {
      // A secure page can't load plain http, so ask for the encrypted address instead.
      if (stream.url.toLowerCase().indexOf('http://') === 0 && !sources.httpAllowedHere()) {
        return 'https://' + stream.url.slice(7);
      }
      return stream.url;
    }

    _engineFor(url) {
      var caps = this.caps, path = url.split('?')[0].toLowerCase();
      if (/\.ts$/.test(path)) return caps.nativeTs || caps.webos ? 'native' : null;
      if (caps.preferNative) return 'native';
      if (caps.hlsjs) return 'hlsjs';
      return caps.nativeHls ? 'native' : null;
    }

    _open() {
      var s = this.streams[this.idx], url = this._url(s);
      var t = now();
      this.openedAt = this.lastProgress = t;
      this.lastTime = null;
      this.advances = 0;
      this.playingReported = false;
      this.triedNative = false;
      this.mediaRecovered = false;
      var engine = this._engineFor(url);
      this.onEvent('opening', { idx: this.idx, n: this.streams.length }, this.channel, s);
      if (!engine) {
        this.unsupported++;
        this.retries = 99;                 // no point retrying: this browser can't play this format
        this._fail('unsupported');
        return;
      }
      if (engine === 'hlsjs') this._openHls(url);
      else this._openNative(url);
    }

    _openNative(url) {
      if (this.hls) {
        try { this.hls.destroy(); } catch (e) { /* already gone */ }
        this.hls = null;
      }
      this.engine = 'native';
      this.video.src = url;
      this._tryPlay();
    }

    _openHls(url) {
      var Hls = root.Hls, self = this;
      var cfg = Object.assign({ enableWorker: true, backBufferLength: 30, startLevel: -1,
                                capLevelToPlayerSize: true }, BUFFERS[this.buffer] || BUFFERS.normal);
      var hls = new Hls(cfg);
      this.hls = hls;
      this.engine = 'hlsjs';
      hls.on(Hls.Events.MANIFEST_PARSED, function () {
        if (self.hls !== hls) return;
        self.onEvent('levels', {}, self.channel, null);
        self._tryPlay();
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, function () {
        if (self.hls === hls) self.onEvent('levels', {}, self.channel, null);
      });
      hls.on(Hls.Events.ERROR, function (_e, data) {
        if (self.hls !== hls || !data || !data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !self.mediaRecovered) {
          self.mediaRecovered = true;
          hls.recoverMediaError();
          return;
        }
        // The stream may refuse web pages (CORS) but still play in the browser's own player.
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !self.playingReported &&
            self.caps.nativeHls && !self.triedNative) {
          self.triedNative = true;
          self._openNative(url);
          return;
        }
        self._fail(data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'network' : 'error');
      });
      hls.loadSource(url);
      hls.attachMedia(this.video);
    }

    _tryPlay() {
      var self = this, v = this.video;
      var p = v.play();
      if (p && p.catch) {
        p.catch(function (e) {
          if (e && e.name === 'NotAllowedError' && self.channel) {
            self.waitingForTap = true;
            self.onEvent('needs_tap', {}, self.channel, null);
          }
        });
      }
    }

    _emitState() {
      if (this.channel) this.onEvent('state', { paused: this.video.paused }, this.channel, null);
    }

    _progress() {
      if (!this.channel || this.retryAt !== null) return;
      var t = this.video.currentTime;
      if (t !== this.lastTime) {
        if (this.lastTime !== null) this.advances++;
        this.lastTime = t;
        this.lastProgress = now();
      }
      if (!this.playingReported && this.advances >= 2 && !this.video.paused) this._reportPlaying();
    }

    _reportPlaying() {
      this.playingReported = this.streamPlayed = this.playedThisSession = true;
      this.waitingForTap = false;
      this.troubleSince = null;
      this.applyFit();
      this.onEvent('playing', { idx: this.idx, n: this.streams.length }, this.channel, this.streams[this.idx]);
    }

    /** Called about once a second. */
    tick() {
      if (!this.channel) return;
      var t = now();
      if (this.retryAt !== null) {
        if (t >= this.retryAt) {
          this.retryAt = null;
          this._open();
        }
        return;
      }
      this._progress();
      // A paused, hidden or waiting-for-a-tap video isn't stuck: don't count that time against it.
      if (this.userPaused || this.waitingForTap || (root.document && document.hidden)) {
        this.lastProgress = t;
        return;
      }
      if (this.video.ended) {
        this._fail('stopped');
      } else if (this.playingReported) {
        if (this.streamPlayed && t - this.openedAt > STABLE_SECONDS) this.retries = 0;
        if (t - this.lastProgress > STALL_SECONDS) this._fail('froze');
      } else if (t - this.lastProgress > OPEN_TIMEOUT) {
        this._fail('slow');
      }
    }

    _fail(reason) {
      this._teardown();
      var t = now(), stream = this.streams[this.idx], n = this.streams.length;
      if (this.playedThisSession && this.troubleSince === null) this.troubleSince = t;
      var delays = this.streamPlayed ? RETRY_DELAYS : START_RETRY_DELAYS;
      if (this.retries < delays.length) {
        var delay = delays[this.retries];
        this.retries++;
        this.retryAt = t + delay;
        this.onEvent('reconnecting', { lost: this.playedThisSession, reason: reason, delay: delay },
                     this.channel, stream);
        return;
      }
      // Never played at all since you pressed play: this stream is genuinely broken (here).
      if (!this.playedThisSession) this.onEvent('stream_dead', { reason: reason }, this.channel, stream);
      this.retries = 0;
      this.streamPlayed = false;
      this.idx++;
      var channel;
      if (this.idx >= n) {
        this.idx = 0;
        if (!this.playedThisSession) {
          channel = this.channel;
          this.channel = null;
          this.onEvent('failed', { unsupported: this.unsupported >= n }, channel, null);
          return;
        }
      }
      if (this.playedThisSession && t - this.troubleSince > KEEP_TRYING_SECONDS) {
        channel = this.channel;
        this.channel = null;
        this.onEvent('lost', {}, channel, null);
        return;
      }
      if (n > 1) {
        this.retryAt = t + 1;
        this.onEvent('switching', { idx: this.idx, n: n }, this.channel, this.streams[this.idx]);
      } else {
        this.retryAt = t + 10;
        this.onEvent('reconnecting', { still: true }, this.channel, stream);
      }
    }
  }

  CS.player = { Player: Player, FITS: FITS, BUFFERS: Object.keys(BUFFERS), detect: detect };
})(this);
