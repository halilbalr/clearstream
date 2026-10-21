"""Small, careful HTTP helpers: verified TLS, size limits, no scheme downgrades."""
import gzip
import http.client
import io
import os
import ssl
import urllib.error
import urllib.parse
import urllib.request

APP_UA = "WazTV/1.0"
# The health check identifies itself the same way the player does, so servers answer it the same way.
PLAYER_UA = "VLC/3.0.24 LibVLC/3.0.24"

_TLS = ssl.create_default_context()


class FetchError(Exception):
    pass


def is_web_url(url):
    try:
        parts = urllib.parse.urlsplit(url)
    except ValueError:
        return False
    return parts.scheme.lower() in ("http", "https") and bool(parts.netloc)


def host_of(url):
    try:
        return (urllib.parse.urlsplit(url).hostname or "").lower()
    except ValueError:
        return ""


def https_first(url):
    """Addresses to try, encrypted first: https://x, then the original http://x."""
    if url.lower().startswith("http://"):
        return ["https://" + url[7:], url]
    return [url]


class _SafeRedirect(urllib.request.HTTPRedirectHandler):
    def __init__(self, allow_http):
        super().__init__()
        self.allow_http = allow_http

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        scheme = urllib.parse.urlsplit(newurl).scheme.lower()
        if scheme not in ("http", "https") or (scheme == "http" and not self.allow_http):
            raise FetchError(f"Refused a redirect to a {scheme or 'non-web'} address")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def open_url(url, timeout=20, allow_http=False, headers=None):
    if not is_web_url(url):
        raise FetchError("Only http(s) addresses are allowed")
    if url.lower().startswith("http://") and not allow_http:
        raise FetchError("Unencrypted http:// is not allowed for this source")
    opener = urllib.request.build_opener(
        _SafeRedirect(allow_http), urllib.request.HTTPSHandler(context=_TLS))
    hdrs = {"User-Agent": APP_UA}
    hdrs.update(headers or {})
    try:
        return opener.open(urllib.request.Request(url, headers=hdrs), timeout=timeout)
    except FetchError:
        raise
    except (urllib.error.URLError, http.client.HTTPException, OSError, ValueError) as e:
        raise FetchError(_describe(e)) from e


def _describe(e):
    if isinstance(e, urllib.error.HTTPError):
        return f"server answered {e.code}"
    reason = getattr(e, "reason", None) or e
    return str(reason)[:200]


def _gunzip(data, limit):
    out = gzip.GzipFile(fileobj=io.BytesIO(data)).read(limit + 1)
    if len(out) > limit:
        raise FetchError("Download is larger than allowed")
    return out


def fetch(url, max_bytes=64 * 1024 * 1024, timeout=30, allow_http=False, headers=None):
    """Download a whole (size-capped) response into memory."""
    try:
        with open_url(url, timeout, allow_http, headers) as r:
            data = r.read(max_bytes + 1)
    except FetchError:
        raise
    except (http.client.HTTPException, OSError) as e:
        raise FetchError(_describe(e)) from e
    if len(data) > max_bytes:
        raise FetchError("Download is larger than allowed")
    if data[:2] == b"\x1f\x8b":
        data = _gunzip(data, max_bytes * 8)
    return data


def fetch_to_file(url, path, max_bytes, timeout=60, allow_http=False):
    """Stream a large (size-capped) download to disk, replacing the file only on success."""
    tmp = path + ".part"
    total = 0
    try:
        with open_url(url, timeout, allow_http) as r, open(tmp, "wb") as f:
            while True:
                chunk = r.read(256 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise FetchError("Download is larger than allowed")
                f.write(chunk)
        os.replace(tmp, path)
    except (http.client.HTTPException, OSError) as e:
        raise FetchError(_describe(e)) from e
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
