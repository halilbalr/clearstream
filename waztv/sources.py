"""Channel sources: the curated free list (iptv-org, strictly filtered) and the user's own paid playlists.

Nothing in a playlist is ever executed. We read names, a few known attributes and http(s) stream
addresses; every other line (including player options that could write files) is ignored.
"""
import ipaddress
import json
import logging
import os
import re
import time
import urllib.parse
from dataclasses import dataclass, field

from . import config, netutil

log = logging.getLogger(__name__)

IPTV_ORG_API = "https://iptv-org.github.io/api/"
FREE_CACHE_TTL = 24 * 3600
SPORT_GROUPS = ("Football", "Tennis", "Cricket")


@dataclass
class Stream:
    url: str
    user_agent: str = ""
    referrer: str = ""
    note: str = ""
    status: str = "unknown"          # unknown / ok / dead


@dataclass
class Channel:
    key: str
    name: str
    country: str
    groups: set
    source: str
    free: bool
    epg_id: str = ""
    streams: list = field(default_factory=list)

    @property
    def status(self):
        states = {s.status for s in self.streams}
        if "ok" in states:
            return "ok"
        if states == {"dead"}:
            return "dead"
        return "unknown"

    def ordered_streams(self):
        rank = {"ok": 0, "unknown": 1, "dead": 2}
        return sorted(self.streams, key=lambda s: rank[s.status])


# --- Grouping -------------------------------------------------------------------------------

_FOOTBALL = re.compile(r"football|soccer|f[uú]tbol|fifa|golazo|\bbein\b|la ?liga|premier league|\bepl\b|"
                       r"uefa|serie a|bundesliga|ligue 1|\bmls\b|\bmutv\b|\blfc\b|talksport|\bgoal", re.I)
_TENNIS = re.compile(r"tennis|\batp\b|\bwta\b|wimbledon|roland.?garros|\bus open\b", re.I)
_CRICKET = re.compile(r"cricket|willow|\bipl\b|\bpsl\b|\bbpl\b|\bicc\b|\bashes\b|\bt20\b", re.I)
_NEWS = re.compile(r"\bnews\b|\bcnn\b|al ?jazeera|al arabiya|\bndtv\b|\bwion\b|aaj tak|samachar|khabar|"
                   r"bloomberg|\bcnbc\b|c-?span|france ?24|euronews|\bdw\b", re.I)
_SPORT = re.compile(r"sport|\bespn\b|\bnfl\b|\bnba\b|\bnhl\b|\bmlb\b|golf|racing|\bf1\b|motor|boxing|"
                    r"\bufc\b|\bmma\b|\bwwe\b|\bdazn\b|\btnt\b|\bpga\b|rugby|kabaddi", re.I)
_SPECIFIC = (("Football", _FOOTBALL), ("Tennis", _TENNIS), ("Cricket", _CRICKET))

# National sports channels that carry cricket without saying so in their name.
_EXTRA_GROUPS = {"DDSports.in": {"Cricket"}, "PTVSports.pk": {"Cricket"}, "TSports.bd": {"Cricket", "Football"}}


def classify(text, news=False, sports=False):
    groups = set()
    if news or _NEWS.search(text):
        groups.add("News")
    for name, rx in _SPECIFIC:
        if rx.search(text):
            groups.add(name)
    if (sports or _SPORT.search(text)) and not groups.intersection(SPORT_GROUPS):
        groups.add("Sports")
    return groups or {"Other"}


# --- Legitimacy filter for the free list ---------------------------------------------------
#
# iptv-org lists any publicly reachable stream, and its sports section mixes official free channels
# with obvious pirate restreams of pay channels. Its own blocklist only covers takedown notices.
# So for the free list we additionally:
#   1. require https and a real host name (no bare IP addresses, which are almost always restreams);
#   2. drop hosts known for restreaming or for running third-party relays;
#   3. for sports, accept only streams served from the commercial video platforms that free
#      ad-supported (FAST) channels and broadcasters themselves use;
#   4. drop pay-TV sports brands entirely, because they are never legitimately free.
# This is a careful filter, not a legal guarantee; see README "What is realistically available".

_BLOCKED_HOSTS = (
    "jmp2.uk", "mjh.nz", "githubusercontent.com", "github.io", "onrender.com", "herokuapp.com",
    "workers.dev", "pages.dev", "glitch.me", "dpdns.org", "ngrok.io", "aynascope.net", "aynaott.com",
    "bozztv.com", "stmify.com", "rezofoot.tv", "mcquack.net", "iptvperu.tv", "boldmss.com",
    "nellaiiptv.com", "cc.cd", "playstop.me", "siauliairsavlt.pw", "rabta.stream", "thelegitpro.in",
    "livelegitpro.in", "jswk.online", "gpcdn.net",
)
_TRUSTED_SPORTS_HOSTS = (
    "amagi.tv", "wurl.com", "wurl.tv", "tubi.video", "tubi.io", "cbsivideo.com", "dai.google.com",
    "nbcuni.com", "brightcove.com", "akamaized.net", "akamaihd.net", "cloudfront.net", "mangomolo.com",
    "mgmlcdn.com", "frequency.stream", "getpublica.com", "klowdtv.com", "sofast.tv", "amazonaws.com",
    "zype.com", "transmit.live", "uplynk.com", "streamlock.net", "wowza.com", "cdn77.org",
    "vgcdn.net", "itworkscdn.net", "streamhoster.com",
)
_PAY_TV = re.compile(
    r"\bsky sports\b|\bbein sports(?! xtra)\b|star sports|sony (sports|ten|six)|\bten (sports|cricket)\b|"
    r"\bespn(?!8)|fox sports [12]\b|\bfs1\b|nfl network|nba tv|\bmsg\b|usa network|wwe network|setanta|"
    r"dsports|tnt sports|\bbt sport|eurosport|\bdazn(?! combat)|^willow( hd)?$|\bmutv\b|supersport|"
    r"sportsnet|\btsn\b|fox deportes|golf channel|premier sports|viaplay|unite8|^m sports$|one golf|"
    r"^pk sports$|^t sports$|ptv sports|ad sports|abu dhabi sports|\bssc\b|kayo|optus sport", re.I)


def _host_matches(host, suffixes):
    return any(host == s or host.endswith("." + s) for s in suffixes)


def _is_ip(host):
    try:
        ipaddress.ip_address(host.strip("[]"))
        return True
    except ValueError:
        return False


def free_stream_allowed(name, is_sports, url):
    if not url.lower().startswith("https://"):
        return False
    host = netutil.host_of(url)
    if not host or _is_ip(host) or _host_matches(host, _BLOCKED_HOSTS):
        return False
    if _PAY_TV.search(name):
        return False
    if is_sports and not _host_matches(host, _TRUSTED_SPORTS_HOSTS):
        return False
    return True


# --- Free list (iptv-org public API) -------------------------------------------------------

def _iptv_org(name, force):
    path = os.path.join(config.CACHE_DIR, f"iptvorg_{name}.json")
    fresh = os.path.exists(path) and time.time() - os.path.getmtime(path) < FREE_CACHE_TTL
    if not force and fresh:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    try:
        data = netutil.fetch(IPTV_ORG_API + name + ".json", max_bytes=80 * 1024 * 1024)
        obj = json.loads(data)
        with open(path, "wb") as f:
            f.write(data)
        return obj
    except (netutil.FetchError, ValueError):
        if os.path.exists(path):
            log.warning("Using older cached copy of iptv-org %s", name)
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        raise


def load_free_channels(countries, force=False):
    channels = _iptv_org("channels", force)
    streams = _iptv_org("streams", force)
    blocked = {b.get("channel") for b in _iptv_org("blocklist", force)}
    wanted = set(countries)
    by_id = {}
    for c in channels:
        if (c.get("country") in wanted and not c.get("is_nsfw") and not c.get("closed")
                and c.get("id") not in blocked
                and ({"news", "sports"} & set(c.get("categories") or []))):
            by_id[c["id"]] = c

    result = {}
    for s in streams:
        c = by_id.get(s.get("channel"))
        url = (s.get("url") or "").strip()
        if not c or not netutil.is_web_url(url):
            continue
        cats = set(c.get("categories") or [])
        name = c.get("name") or c["id"]
        if not free_stream_allowed(name, "sports" in cats, url):
            continue
        ch = result.get(c["id"])
        if ch is None:
            text = " ".join([name] + list(c.get("alt_names") or []))
            groups = classify(text, news="news" in cats, sports="sports" in cats)
            groups |= _EXTRA_GROUPS.get(c["id"], set())
            if groups & set(SPORT_GROUPS):
                groups.discard("Sports")
            groups.discard("Other")
            ch = result[c["id"]] = Channel(key="free:" + c["id"], name=name, country=c["country"],
                                           groups=groups, source="Free (iptv-org)", free=True,
                                           epg_id=c["id"])
        if any(x.url == url for x in ch.streams):
            continue
        ch.streams.append(Stream(url=url, user_agent=s.get("user_agent") or "",
                                 referrer=s.get("referrer") or "", note=", ".join(s.get("labels") or [])))
    for ch in result.values():   # streams the list already flags as geo-blocked go last
        ch.streams.sort(key=lambda x: "Geo-blocked" in x.note)
    return list(result.values())


# --- The user's own playlists ----------------------------------------------------------------

_ATTR = re.compile(r'([\w-]+)="([^"]*)"')
_NOISE = re.compile(r"\(.*?\)|\[.*?\]|\b(f?hd|uhd|sd|4k|hevc|h\.?26[45]|\d{3,4}p|\d+fps|backup|alt|vip|raw)\b",
                    re.I)
_ALLOWED_VLC_OPTS = {"http-user-agent": "user_agent", "http-referrer": "referrer", "http-referer": "referrer"}


def _norm(name):
    s = _NOISE.sub(" ", name.casefold())
    s = re.sub(r"[^\w]+", " ", s)
    return " ".join(s.split()) or name.casefold()


def _split_extinf(line):
    body = line[len("#EXTINF:"):]
    quoted = False
    for i, ch in enumerate(body):
        if ch == '"':
            quoted = not quoted
        elif ch == "," and not quoted:
            return body[:i], body[i + 1:].strip()
    return body, ""


def _add_stream(channels, key, name, country, groups, source_name, epg_id, stream):
    ch = channels.get(key)
    if ch is None:
        ch = channels[key] = Channel(key=key, name=name, country=country, groups=groups,
                                     source=source_name, free=False, epg_id=epg_id)
    if not ch.epg_id and epg_id:
        ch.epg_id = epg_id
    if not any(x.url == stream.url for x in ch.streams):
        ch.streams.append(stream)


def parse_m3u(text, source_id, source_name):
    """Returns (channels, programme-guide addresses named in the playlist header)."""
    channels, epg_urls = {}, []
    pending, opts, extgrp = None, {}, ""
    for raw in text.splitlines():
        line = raw.strip().lstrip("﻿")
        if not line:
            continue
        if line.startswith("#EXTM3U"):
            for k, v in _ATTR.findall(line):
                if k.lower() in ("x-tvg-url", "url-tvg"):
                    epg_urls += [u.strip() for u in v.split(",") if netutil.is_web_url(u.strip())]
        elif line.startswith("#EXTINF"):
            head, name = _split_extinf(line)
            attrs = {k.lower(): v for k, v in _ATTR.findall(head)}
            pending, opts, extgrp = (name or attrs.get("tvg-name") or "Unnamed", attrs), {}, ""
        elif line.startswith("#EXTVLCOPT:"):
            k, _, v = line[len("#EXTVLCOPT:"):].partition("=")
            field_name = _ALLOWED_VLC_OPTS.get(k.strip().lower())
            if field_name:           # every other player option is ignored on purpose
                opts[field_name] = v.strip()
        elif line.startswith("#EXTGRP:"):
            extgrp = line[len("#EXTGRP:"):].strip()
        elif line.startswith("#"):
            continue
        else:
            if pending is None:
                continue
            name, attrs = pending
            pending = None
            if not netutil.is_web_url(line) or re.search(r"/(movie|series)/", line, re.I):
                continue
            group_title = attrs.get("group-title") or extgrp
            country = (attrs.get("tvg-country") or "")[:2].upper()
            _add_stream(channels, f"{source_id}:{_norm(name)}", name, country,
                        classify(f"{name} {group_title}"), source_name, attrs.get("tvg-id", "").strip(),
                        Stream(url=line, user_agent=opts.get("user_agent", ""),
                               referrer=opts.get("referrer", "")))
    return list(channels.values()), epg_urls


def _load_m3u_url(src, secret):
    last = None
    for url in netutil.https_first(secret["url"]):
        try:
            data = netutil.fetch(url, max_bytes=200 * 1024 * 1024, timeout=60, allow_http=True)
            channels, epg = parse_m3u(data.decode("utf-8", "replace"), src["id"], src["name"])
            return channels, epg, url.lower().startswith("https://")
        except netutil.FetchError as e:
            last = e
    raise netutil.FetchError(f"Could not download the playlist: {last}")


def _load_m3u_file(src):
    with open(src["path"], encoding="utf-8", errors="replace") as f:
        channels, epg = parse_m3u(f.read(), src["id"], src["name"])
    return channels, epg, True


def _xtream_base(server):
    s = server.strip().rstrip("/")
    if "://" not in s:
        s = "http://" + s
    parts = urllib.parse.urlsplit(s)
    return f"{parts.scheme}://{parts.netloc}"


def _load_xtream(src, secret):
    user, pw = secret["username"], secret["password"]
    qs = urllib.parse.urlencode({"username": user, "password": pw})
    last, base = None, None
    for candidate in netutil.https_first(_xtream_base(secret["server"])):
        try:
            info = json.loads(netutil.fetch(f"{candidate}/player_api.php?{qs}", allow_http=True))
            if str((info.get("user_info") or {}).get("auth")) != "1":
                raise netutil.FetchError("the provider rejected the username or password")
            base = candidate
            break
        except (netutil.FetchError, ValueError, AttributeError) as e:
            last = e
    if base is None:
        raise netutil.FetchError(f"Could not log in to the Xtream service: {last}")

    def api(action):
        data = json.loads(netutil.fetch(f"{base}/player_api.php?{qs}&action={action}",
                                        max_bytes=200 * 1024 * 1024, timeout=60, allow_http=True))
        return data if isinstance(data, list) else []

    categories = {str(c.get("category_id")): c.get("category_name") or "" for c in api("get_live_categories")}
    u, p = urllib.parse.quote(user, safe=""), urllib.parse.quote(pw, safe="")
    channels = {}
    for item in api("get_live_streams"):
        sid = str(item.get("stream_id") or "")
        name = str(item.get("name") or "").strip()
        if not sid.isdigit() or not name:
            continue
        group_title = categories.get(str(item.get("category_id")), "")
        key = f"{src['id']}:{_norm(name)}"
        groups = classify(f"{name} {group_title}")
        epg_id = str(item.get("epg_channel_id") or "")
        stem = f"{base}/live/{u}/{p}/{sid}"
        _add_stream(channels, key, name, "", groups, src["name"], epg_id, Stream(url=stem + ".m3u8"))
        _add_stream(channels, key, name, "", groups, src["name"], epg_id, Stream(url=stem + ".ts", note="TS"))
    return list(channels.values()), [f"{base}/xmltv.php?{qs}"], base.startswith("https://")


def load_user_source(src):
    """Returns (channels, programme-guide addresses, uses_https)."""
    if src["type"] == "m3u_file":
        return _load_m3u_file(src)
    secret = config.unprotect(src["secret"])
    if src["type"] == "m3u_url":
        return _load_m3u_url(src, secret)
    if src["type"] == "xtream":
        return _load_xtream(src, secret)
    raise ValueError(f"Unknown source type {src['type']}")
