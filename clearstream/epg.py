"""Programme guide (XMLTV): download, keep only what's on around now, answer 'now / next'."""
import datetime as dt
import gzip
import hashlib
import logging
import os
import time
import xml.etree.ElementTree as ET

from . import config, netutil

log = logging.getLogger(__name__)

CACHE_TTL = 12 * 3600
MAX_BYTES = 400 * 1024 * 1024
UTC = dt.timezone.utc


def norm_id(epg_id):
    return (epg_id or "").split("@")[0].strip().casefold()


def _parse_time(value):
    value = (value or "").strip()
    base = dt.datetime.strptime(value[:14], "%Y%m%d%H%M%S")
    tz = value[14:].strip()
    if len(tz) == 5 and tz[0] in "+-" and tz[1:].isdigit():
        offset = dt.timedelta(hours=int(tz[1:3]), minutes=int(tz[3:5]))
        return base.replace(tzinfo=dt.timezone(offset if tz[0] == "+" else -offset))
    return base.replace(tzinfo=UTC)


def download(url, allow_http):
    """Cached download; the cache file name is a hash, so private addresses aren't written to disk."""
    path = os.path.join(config.CACHE_DIR, "epg_" + hashlib.sha256(url.encode()).hexdigest()[:24] + ".xml")
    if os.path.exists(path) and time.time() - os.path.getmtime(path) < CACHE_TTL:
        return path
    last = None
    for candidate in netutil.https_first(url) if allow_http else [url]:
        try:
            netutil.fetch_to_file(candidate, path, MAX_BYTES, timeout=120, allow_http=allow_http)
            return path
        except netutil.FetchError as e:
            last = e
    if os.path.exists(path):
        return path          # an older guide is better than none
    raise netutil.FetchError(str(last))


def parse(path, wanted):
    """Read programmes for the wanted channel ids, from 2 hours ago to 36 hours ahead."""
    now = dt.datetime.now(UTC)
    lo, hi = now - dt.timedelta(hours=2), now + dt.timedelta(hours=36)
    out = {}
    with open(path, "rb") as raw:
        magic = raw.read(2)
    opener = gzip.open if magic == b"\x1f\x8b" else open
    with opener(path, "rb") as f:
        for _event, elem in ET.iterparse(f, events=("end",)):
            if elem.tag == "programme":
                cid = norm_id(elem.get("channel"))
                if cid in wanted:
                    try:
                        start, stop = _parse_time(elem.get("start")), _parse_time(elem.get("stop"))
                    except ValueError:
                        start = stop = None
                    if start and stop > lo and start < hi:
                        title = (elem.findtext("title") or "").strip() or "(untitled)"
                        out.setdefault(cid, []).append((start, stop, title))
                elem.clear()
            elif elem.tag == "channel":
                elem.clear()
    for progs in out.values():
        progs.sort()
    return out


class Guide:
    def __init__(self):
        self.progs = {}

    def merge(self, parsed):
        for cid, progs in parsed.items():
            if cid not in self.progs:      # the first guide that knows a channel wins
                self.progs[cid] = progs

    def now_next(self, epg_id):
        progs = self.progs.get(norm_id(epg_id))
        if not progs:
            return None, None
        now = dt.datetime.now(UTC)
        for i, p in enumerate(progs):
            if p[0] <= now < p[1]:
                return p, progs[i + 1] if i + 1 < len(progs) else None
            if p[0] > now:
                return None, p
        return None, None


def fmt(prog):
    if not prog:
        return ""
    start, stop, title = prog
    return f"{start.astimezone():%H:%M}–{stop.astimezone():%H:%M}  {title}"
