"""Playback on top of libVLC, with buffering, automatic reconnect and automatic switch to backup streams."""
import logging
import os
import sys
import time

log = logging.getLogger(__name__)

if getattr(sys, "frozen", False):
    # The downloadable Clearstream.exe carries its own copy of VLC in a "vlc" folder beside it.
    _VLC_DIR = os.path.join(os.path.dirname(sys.executable), "vlc")
    os.environ["PYTHON_VLC_LIB_PATH"] = os.path.join(_VLC_DIR, "libvlc.dll")
    os.environ["PYTHON_VLC_MODULE_PATH"] = _VLC_DIR
    os.environ["VLC_PLUGIN_PATH"] = os.path.join(_VLC_DIR, "plugins")

try:
    import vlc
except Exception as e:          # python-vlc raises various errors when libVLC can't be found or loaded
    vlc = None
    _IMPORT_ERROR = e
else:
    _IMPORT_ERROR = None


class PlayerUnavailable(Exception):
    pass


RETRY_DELAYS = (2, 5, 10)    # waits before reconnecting a stream that was playing and dropped
START_RETRY_DELAYS = (2,)    # a stream that never started gets one quick retry, then the backup
KEEP_TRYING_SECONDS = 180    # once a channel has played, keep reconnecting through an outage this long
STALL_SECONDS = 15           # playing but nothing new decoded for this long = dropped
OPEN_TIMEOUT = 25            # still opening/buffering after this long = failed
STABLE_SECONDS = 30          # after this much smooth playback, the retry budget resets

# Picture shapes. "auto" fixes standard-definition widescreen sent without its 16:9 flag
# (it arrives as 720x576 or 720x480 and would otherwise look squashed with side bars).
ASPECTS = {"auto": "Auto", "16:9": "16:9", "4:3": "4:3", "fill": "Fill screen", "original": "Original"}
_SD_SIZES = {(720, 576), (704, 576), (720, 480), (704, 480), (544, 576), (480, 576)}


class Player:
    def __init__(self, hwnd, buffer_ms, volume, on_event):
        if vlc is None:
            raise PlayerUnavailable(str(_IMPORT_ERROR))
        args = [
            f"--network-caching={buffer_ms}",
            f"--live-caching={buffer_ms}",
            # HLS/DASH keep their own live buffer: 15 s at the normal setting, double that at most.
            f"--adaptive-livedelay={buffer_ms * 5}",
            f"--adaptive-maxbuffer={buffer_ms * 10}",
            "--http-reconnect",                 # libVLC resumes a broken HTTP connection by itself first
            "--no-lua",                         # no scripting engine at all
            "--no-metadata-network-access",     # VLC won't look anything up online
            "--no-video-title-show",
            "--no-snapshot-preview",
            "--quiet",
        ]
        self.instance = vlc.Instance(args)
        if self.instance is None:
            raise PlayerUnavailable("libVLC could not start")
        self.mp = self.instance.media_player_new()
        self.mp.set_hwnd(hwnd)
        self.mp.video_set_mouse_input(False)
        self.mp.video_set_key_input(False)
        self.mp.audio_set_volume(int(volume))
        self.on_event = on_event         # on_event(kind, message, channel, stream)
        self.aspect = "auto"
        self.window_size = lambda: (16, 9)
        self.channel = None
        self.streams = []
        self._reset_state()

    def _reset_state(self):
        self.idx = 0
        self.retries = 0
        self.retry_at = None
        self.opened_at = 0.0
        self.last_progress = 0.0
        self.last_marker = None
        self.playing_reported = False
        self.played_this_session = False   # any stream of this channel played since you pressed play
        self.stream_played = False          # the current stream played
        self.trouble_since = None

    # --- public -------------------------------------------------------------------------

    def play(self, channel):
        self.stop()
        self.channel = channel
        self.streams = channel.ordered_streams()
        self._reset_state()
        if not self.streams:
            self.on_event("failed", "This channel has no streams.", channel, None)
            self.channel = None
            return
        self._open()

    def stop(self):
        self.channel = None
        self.retry_at = None
        self.mp.stop()

    def set_aspect(self, mode):
        self.aspect = mode
        self.apply_aspect()

    def apply_aspect(self):
        """Set the picture shape; safe to call any time (e.g. when the window is resized)."""
        mode = self.aspect
        if mode == "fill":
            w, h = self.window_size()
            ratio = f"{max(w, 1)}:{max(h, 1)}"
        elif mode == "auto":
            ratio = "16:9" if tuple(self.mp.video_get_size()) in _SD_SIZES else None
        elif mode == "original":
            ratio = None
        else:
            ratio = mode
        self.mp.video_set_aspect_ratio(ratio)

    def set_volume(self, v):
        self.mp.audio_set_volume(int(v))

    def release(self):
        self.stop()
        self.mp.release()
        self.instance.release()

    # --- internals ----------------------------------------------------------------------

    def _open(self):
        s = self.streams[self.idx]
        media = self.instance.media_new(s.url)
        if s.user_agent:
            media.add_option(f":http-user-agent={s.user_agent}")
        if s.referrer:
            media.add_option(f":http-referrer={s.referrer}")
        self.mp.set_media(media)
        media.release()
        self.mp.play()
        now = time.monotonic()
        self.opened_at = self.last_progress = now
        self.last_marker = None
        self.playing_reported = False
        n = len(self.streams)
        label = f" (stream {self.idx + 1} of {n})" if n > 1 else ""
        self.on_event("opening", f"Connecting{label}…", self.channel, s)

    def _marker(self):
        media = self.mp.get_media()
        decoded = 0
        if media is not None:
            stats = vlc.MediaStats()
            if media.get_stats(stats):
                decoded = stats.decoded_video + stats.decoded_audio
        return decoded, self.mp.get_time()

    def tick(self):
        """Called about once a second from the UI thread."""
        if self.channel is None:
            return
        now = time.monotonic()
        if self.retry_at is not None:
            if now >= self.retry_at:
                self.retry_at = None
                self._open()
            return
        state = self.mp.get_state()
        marker = self._marker()
        if marker != self.last_marker:
            self.last_marker = marker
            self.last_progress = now
        if state in (vlc.State.Error, vlc.State.Ended):
            self._fail("the stream stopped")
        elif state == vlc.State.Playing:
            if marker[0] > 0 and not self.playing_reported:
                self.playing_reported = self.stream_played = self.played_this_session = True
                self.apply_aspect()
                self.trouble_since = None
                n = len(self.streams)
                label = f" (stream {self.idx + 1} of {n})" if n > 1 else ""
                self.on_event("playing", f"Playing{label}", self.channel, self.streams[self.idx])
            if self.stream_played and now - self.opened_at > STABLE_SECONDS:
                self.retries = 0
            if now - self.last_progress > STALL_SECONDS:
                self._fail("the picture froze")
        elif now - self.last_progress > OPEN_TIMEOUT:
            self._fail("it took too long to start")

    def _fail(self, reason):
        self.mp.stop()
        now = time.monotonic()
        stream = self.streams[self.idx]
        if self.played_this_session and self.trouble_since is None:
            self.trouble_since = now
        delays = RETRY_DELAYS if self.stream_played else START_RETRY_DELAYS
        if self.retries < len(delays):
            delay = delays[self.retries]
            self.retries += 1
            self.retry_at = now + delay
            what = "Connection lost" if self.played_this_session else "Couldn't start"
            self.on_event("reconnecting", f"{what} ({reason}). Retrying in {delay}s…", self.channel, stream)
            return
        if not self.played_this_session:
            # Never played at all since you pressed play: this stream is genuinely broken.
            self.on_event("stream_dead", "", self.channel, stream)
        self.retries = 0
        self.stream_played = False
        self.idx += 1
        if self.idx >= len(self.streams):
            self.idx = 0
            if not self.played_this_session:
                channel = self.channel
                self.channel = None
                self.on_event("failed", "This channel isn't working right now (every stream failed). "
                              "It has been marked offline; try again later.", channel, None)
                return
        if self.played_this_session and now - self.trouble_since > KEEP_TRYING_SECONDS:
            channel = self.channel
            self.channel = None
            self.on_event("lost", "The connection has been down for 3 minutes, so playback stopped. "
                          "Check your internet, then double-click the channel to try again.", channel, None)
            return
        if len(self.streams) > 1:
            self.retry_at = now + 1
            self.on_event("switching", f"Switching to backup stream {self.idx + 1} of {len(self.streams)}…",
                          self.channel, self.streams[self.idx])
        else:
            self.retry_at = now + 10
            self.on_event("reconnecting", "Still trying to reconnect…", self.channel, stream)
