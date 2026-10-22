"""Build the downloadable Windows release: dist/Clearstream-<version>-windows-x64.zip

Run from the repository folder with 64-bit Python 3.10+ and 64-bit VLC installed:

    python tools/build_release.py

It creates a separate build environment (.venv-build) with hash-pinned tools, freezes the app with
PyInstaller, copies the parts of the installed VLC that playback needs next to Clearstream.exe,
adds the licences of everything bundled, and zips the result.
"""
import hashlib
import os
import shutil
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENV = os.path.join(ROOT, ".venv-build")
PY = os.path.join(VENV, "Scripts", "python.exe")
DIST = os.path.join(ROOT, "dist")
APP_DIR = os.path.join(DIST, "Clearstream")
VLC_SRC = os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "VideoLAN", "VLC")

# VLC plugin folders Clearstream never uses: VLC's own interface, scripting, recording/streaming out,
# visualisations and network discovery. Leaving them out makes the download smaller and the bundle
# safer (no Lua scripting engine at all).
SKIP_PLUGINS = {"gui", "lua", "control", "visualization", "services_discovery", "access_output",
                "stream_out", "mux", "video_splitter"}


def run(*cmd):
    print(">", " ".join(cmd))
    subprocess.run(cmd, check=True, cwd=ROOT)


def version():
    ns = {}
    with open(os.path.join(ROOT, "clearstream", "__init__.py"), encoding="utf-8") as f:
        exec(f.read(), ns)
    return ns["__version__"]


def build_env():
    if not os.path.exists(PY):
        run(sys.executable, "-m", "venv", VENV)
    for req in ("requirements-build.txt", "requirements.txt"):
        run(PY, "-m", "pip", "install", "--quiet", "--disable-pip-version-check", "--only-binary", ":all:",
            "--no-deps", "--require-hashes", "-r", req)


def freeze():
    shutil.rmtree(APP_DIR, ignore_errors=True)
    run(PY, "-m", "PyInstaller", "--noconfirm", "--clean", "--onedir", "--windowed", "--name", "Clearstream",
        "--distpath", DIST, "--workpath", os.path.join(ROOT, "build", "work"),
        "--specpath", os.path.join(ROOT, "build"), "--paths", ROOT, "--hidden-import", "vlc",
        os.path.join(ROOT, "tools", "launcher.py"))


def bundle_vlc():
    if not os.path.exists(os.path.join(VLC_SRC, "libvlc.dll")):
        sys.exit(f"64-bit VLC not found in {VLC_SRC}; install it from https://www.videolan.org first.")
    dst = os.path.join(APP_DIR, "vlc")
    os.makedirs(dst, exist_ok=True)
    for name in ("libvlc.dll", "libvlccore.dll"):
        shutil.copy2(os.path.join(VLC_SRC, name), dst)
    plugins = os.path.join(dst, "plugins")
    for folder in os.listdir(os.path.join(VLC_SRC, "plugins")):
        src = os.path.join(VLC_SRC, "plugins", folder)
        if os.path.isdir(src) and folder not in SKIP_PLUGINS:
            shutil.copytree(src, os.path.join(plugins, folder))
    # A fresh plugin cache so VLC doesn't rescan every plugin at each start-up.
    run(os.path.join(VLC_SRC, "vlc-cache-gen.exe"), plugins)


def licences():
    lic = os.path.join(APP_DIR, "licences")
    os.makedirs(lic, exist_ok=True)
    shutil.copy2(os.path.join(ROOT, "LICENSE"), os.path.join(lic, "Clearstream-LICENSE.txt"))
    shutil.copy2(os.path.join(VLC_SRC, "COPYING.txt"), os.path.join(lic, "VLC-COPYING.txt"))
    py_lic = os.path.join(sys.base_prefix, "LICENSE.txt")
    if os.path.exists(py_lic):
        shutil.copy2(py_lic, os.path.join(lic, "Python-LICENSE.txt"))
    vlc_version = subprocess.run(["powershell", "-NoProfile", "-Command",
                                  f"(Get-Item '{os.path.join(VLC_SRC, 'libvlc.dll')}').VersionInfo.ProductVersion"],
                                 capture_output=True, text=True).stdout.strip()
    with open(os.path.join(lic, "THIRD-PARTY-NOTICES.txt"), "w", encoding="utf-8") as f:
        f.write(f"""Clearstream {version()} bundles these third-party components, unchanged:

* libVLC and VLC plugins {vlc_version} (VideoLAN) - LGPL-2.1-or-later / GPL-2.0-or-later.
  Copied from the official VLC for Windows installer. Source code: https://code.videolan.org/videolan/vlc
  Full licence: VLC-COPYING.txt
* python-vlc (VideoLAN) - LGPL-2.1-or-later. Source: https://github.com/oaubert/python-vlc
* Python and its standard library, including Tcl/Tk (Python Software Foundation) - PSF License.
  Source: https://www.python.org/downloads/source/  Full licence: Python-LICENSE.txt
* Packaged with PyInstaller (GPL-2.0 with an exception that allows bundling apps under any licence).

Clearstream's own code is MIT-licensed: Clearstream-LICENSE.txt
""")


def readme():
    with open(os.path.join(APP_DIR, "READ ME FIRST.txt"), "w", encoding="utf-8") as f:
        f.write(f"""Clearstream {version()} for Windows 10/11 (64-bit)

1. Keep this whole folder together (Clearstream.exe needs the files beside it).
2. Double-click Clearstream.exe.
   Windows may say "Windows protected your PC" because the app isn't code-signed:
   click "More info", then "Run anyway".

Nothing else to install: VLC's playback engine is included.
Your settings are kept in %APPDATA%\\Clearstream.
More help: https://github.com/killerwaz/clearstream
""")


def zip_it():
    name = os.path.join(DIST, f"Clearstream-{version()}-windows-x64.zip")
    if os.path.exists(name):
        os.remove(name)
    with zipfile.ZipFile(name, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for folder, _dirs, files in os.walk(APP_DIR):
            for file in files:
                full = os.path.join(folder, file)
                z.write(full, os.path.relpath(full, DIST))
    digest = hashlib.sha256(open(name, "rb").read()).hexdigest()
    print(f"\nBuilt {name}\n{os.path.getsize(name) / 1e6:.1f} MB  sha256 {digest}")


if __name__ == "__main__":
    build_env()
    freeze()
    bundle_vlc()
    licences()
    readme()
    zip_it()
