"""Paths, settings, and Windows-protected storage for passwords and private links."""
import base64
import copy
import ctypes
import json
import logging
import os
import threading
from ctypes import wintypes

APP_NAME = "Waz TV"
DATA_DIR = os.path.join(os.environ.get("APPDATA") or os.path.expanduser("~"), APP_NAME)
CACHE_DIR = os.path.join(DATA_DIR, "cache")
SETTINGS_PATH = os.path.join(DATA_DIR, "settings.json")
LOG_PATH = os.path.join(DATA_DIR, "waztv.log")

# iptv-org country codes for the countries chosen at setup.
COUNTRY_NAMES = {
    "UK": "United Kingdom", "US": "United States", "IN": "India", "PK": "Pakistan",
    "BD": "Bangladesh", "AU": "Australia", "AE": "UAE", "SA": "Saudi Arabia",
    "QA": "Qatar", "KW": "Kuwait", "BH": "Bahrain", "OM": "Oman",
}

DEFAULTS = {
    "countries": list(COUNTRY_NAMES),
    "favourites": [],
    "sources": [],      # the user's own paid playlists; secrets are DPAPI-encrypted
    "epg_urls": [],     # extra programme-guide (XMLTV) addresses
    "volume": 80,
    "aspect": {},       # channel key -> picture shape chosen for that channel
    "dark_mode": False,
    "buffer_ms": 3000,
}

_lock = threading.Lock()
log = logging.getLogger(__name__)


def ensure_dirs():
    # The app used to be called SafeIPTV; carry its settings over once.
    old = os.path.join(os.path.dirname(DATA_DIR), "SafeIPTV")
    if os.path.isdir(old) and not os.path.exists(DATA_DIR):
        try:
            os.replace(old, DATA_DIR)
        except OSError:
            pass
    os.makedirs(CACHE_DIR, exist_ok=True)


def load_settings():
    settings = copy.deepcopy(DEFAULTS)
    try:
        with open(SETTINGS_PATH, encoding="utf-8") as f:
            stored = json.load(f)
        if isinstance(stored, dict):
            settings.update({k: v for k, v in stored.items() if k in DEFAULTS})
    except FileNotFoundError:
        pass
    except (OSError, ValueError):
        log.exception("Settings file unreadable; using defaults")
    return settings


def save_settings(settings):
    with _lock:
        tmp = SETTINGS_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=2)
        os.replace(tmp, SETTINGS_PATH)


# --- Windows DPAPI: secrets can only be decrypted by this Windows user account ---

class _Blob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


_crypt32 = ctypes.windll.crypt32
_kernel32 = ctypes.windll.kernel32
_kernel32.LocalFree.argtypes = [ctypes.c_void_p]
_kernel32.LocalFree.restype = ctypes.c_void_p
_CRYPTPROTECT_UI_FORBIDDEN = 0x1


def _run_dpapi(func, data):
    buf = ctypes.create_string_buffer(data, len(data))
    blob_in = _Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
    blob_out = _Blob()
    if not func(ctypes.byref(blob_in), None, None, None, None,
                _CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(blob_out)):
        raise OSError("Windows could not protect/unprotect the stored secret")
    try:
        return ctypes.string_at(blob_out.pbData, blob_out.cbData)
    finally:
        _kernel32.LocalFree(ctypes.cast(blob_out.pbData, ctypes.c_void_p))


def protect(obj):
    """Encrypt a JSON-able object with the current Windows user's key."""
    raw = json.dumps(obj).encode("utf-8")
    return base64.b64encode(_run_dpapi(_crypt32.CryptProtectData, raw)).decode("ascii")


def unprotect(token):
    raw = _run_dpapi(_crypt32.CryptUnprotectData, base64.b64decode(token))
    return json.loads(raw.decode("utf-8"))
