"""Quick 'is this channel alive?' check, so dead links are marked before you click them."""
import concurrent.futures
import datetime as dt
import hashlib
import http.client
import json
import logging
import os
import re
import threading
import time
import urllib.parse

from . import config, netutil

log = logging.getLogger(__name__)

CACHE_PATH = os.path.join(config.CACHE_DIR, "health.json")
TTL = 6 * 3600
STALE_MINUTES = 30
_NET_ERRORS = (netutil.FetchError, OSError, ValueError, http.client.HTTPException)
_HLS_TYPES = ("mpegurl", "video/", "audio/", "octet-stream", "mp2t")


class HealthCache:
    """Remembers results for a few hours. Keys are hashed so no private address is stored in clear."""

    def __init__(self):
        self._lock = threading.Lock()
        try:
            with open(CACHE_PATH, encoding="utf-8") as f:
                self._data = json.load(f)
        except (OSError, ValueError):
            self._data = {}

    @staticmethod
    def _key(url):
        return hashlib.sha256(url.encode("utf-8")).hexdigest()[:32]

    def get(self, url):
        entry = self._data.get(self._key(url))
        if entry and time.time() - entry["t"] < TTL:
            return entry["s"]
        return None

    def put(self, url, status):
        with self._lock:
            self._data[self._key(url)] = {"s": status, "t": time.time()}

    def save(self):
        with self._lock:
            now = time.time()
            data = {k: v for k, v in self._data.items() if now - v["t"] < TTL}
            tmp = CACHE_PATH + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f)
            os.replace(tmp, CACHE_PATH)

    def apply(self, channels):
        for ch in channels:
            for s in ch.streams:
                s.status = self.get(s.url) or "unknown"


def _looks_like_video(body, content_type):
    if body.lstrip().startswith(b"#EXTM3U"):
        return True
    if body[:1] == b"\x47":            # MPEG-TS sync byte
        return True
    return any(t in content_type for t in _HLS_TYPES) and not body.lstrip().startswith(b"<")


def _fresh_media_playlist(text):
    """A live playlist whose newest timestamp is old has frozen: it answers, but never plays."""
    if "#EXTINF" not in text or "#EXT-X-ENDLIST" in text:
        return True
    stamps = re.findall(r"#EXT-X-PROGRAM-DATE-TIME:\s*(\S+)", text)
    if not stamps:
        return True
    try:
        newest = dt.datetime.fromisoformat(stamps[-1].replace("Z", "+00:00"))
    except ValueError:
        return True
    if newest.tzinfo is None:
        newest = newest.replace(tzinfo=dt.timezone.utc)
    return dt.datetime.now(dt.timezone.utc) - newest < dt.timedelta(minutes=STALE_MINUTES)


def _segment_ok(playlist_url, text, headers, timeout):
    """Fetch the start of the newest video segment. Geo-blocking is usually enforced here, not on
    the playlist, so a playlist that loads can still be unwatchable from your country."""
    uris = [l.strip() for l in text.splitlines() if l.strip() and not l.startswith("#")]
    if not uris:
        return False
    try:
        with netutil.open_url(urllib.parse.urljoin(playlist_url, uris[-1]), timeout,
                              allow_http=True, headers=headers) as r:
            data = r.read(2048)
    except _NET_ERRORS:
        return False
    return bool(data) and not data.lstrip().startswith(b"<")


def _media_ok(url, text, headers, timeout):
    if "#EXTINF" not in text:
        return True
    return _fresh_media_playlist(text) and _segment_ok(url, text, headers, timeout)


def probe(url, user_agent="", referrer="", timeout=8):
    headers = {"User-Agent": user_agent or netutil.PLAYER_UA}
    if referrer:
        headers["Referer"] = referrer
    try:
        with netutil.open_url(url, timeout, allow_http=True, headers=headers) as r:
            final_url = r.geturl()
            ctype = (r.headers.get("Content-Type") or "").lower()
            body = r.read(65536)
    except _NET_ERRORS:
        return False
    if not _looks_like_video(body, ctype):
        return False
    text = body.decode("utf-8", "replace")
    if "#EXT-X-STREAM-INF" not in text:
        return _media_ok(final_url, text, headers, timeout)
    # A master playlist can be served while every quality behind it is dead; check the first one.
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if line.startswith("#EXT-X-STREAM-INF"):
            variant = next((l.strip() for l in lines[i + 1:] if l.strip() and not l.startswith("#")), "")
            if not variant:
                return False
            try:
                with netutil.open_url(urllib.parse.urljoin(final_url, variant), timeout,
                                      allow_http=True, headers=headers) as r2:
                    variant_url = r2.geturl()
                    sub = r2.read(65536)
            except _NET_ERRORS:
                return False
            return (sub.lstrip().startswith(b"#EXTM3U")
                    and _media_ok(variant_url, sub.decode("utf-8", "replace"), headers, timeout))
    return True


def check_stream(stream):
    """Probe one stream; for http:// addresses try the https:// version first and keep it if it works."""
    if stream.url.lower().startswith("http://"):
        secure = "https://" + stream.url[7:]
        if probe(secure, stream.user_agent, stream.referrer, timeout=5):
            stream.url = secure
            return "ok"
    return "ok" if probe(stream.url, stream.user_agent, stream.referrer) else "dead"


def check_channels(channels, cache, workers, progress, cancel):
    """Runs in a background thread. progress(done, total, channel) is called after each channel."""
    todo = list(channels)
    total = len(todo)

    def one(ch):
        for s in ch.streams:
            if cancel.is_set():
                return ch
            try:
                s.status = check_stream(s)
            except Exception:
                log.exception("unexpected error while checking a stream")
                s.status = "dead"
            cache.put(s.url, s.status)
        return ch

    done = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for fut in concurrent.futures.as_completed([pool.submit(one, ch) for ch in todo]):
            done += 1
            try:
                progress(done, total, fut.result())
            except Exception:
                log.exception("health check failed for a channel")
    cache.save()
