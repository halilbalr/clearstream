"""The main window."""
import ctypes
import logging
import os
import queue
import threading
import tkinter as tk
import uuid
from tkinter import filedialog, messagebox, ttk

from . import config, epg, health, netutil, sources
from .player import ASPECTS, Player, PlayerUnavailable

log = logging.getLogger(__name__)

GROUPS = ["Favourites", "Football", "Tennis", "Cricket", "News", "Sports", "Other", "All channels"]
STATUS_TEXT = {"ok": "● Live", "dead": "✕ Offline", "unknown": "· Not checked"}
STATUS_RANK = {"ok": 0, "unknown": 1, "dead": 2}
ALL_COUNTRIES = "All countries"
BUFFERS = [(1500, "Short – less delay behind live"), (3000, "Normal – recommended"),
           (6000, "Long – for slow or unsteady internet")]


THEMES = {
    "light": {"bg": "#f3f3f3", "panel": "#ffffff", "fg": "#1f1f1f", "muted": "#5f5f5f", "border": "#d0d0d0",
              "sel": "#cce4f7", "selfg": "#000000", "hover": "#e5e5e5", "field": "#ffffff",
              "ok": "#0b6e2f", "dead": "#9a9a9a"},
    "dark": {"bg": "#1e1e1e", "panel": "#252526", "fg": "#e6e6e6", "muted": "#a0a0a0", "border": "#3c3c3c",
             "sel": "#094771", "selfg": "#ffffff", "hover": "#333333", "field": "#2d2d2d",
             "ok": "#4ec97b", "dead": "#6b6b6b"},
}


def _dark_title_bar(window, on):
    """Ask Windows 10/11 to draw this window's title bar dark (ignored on older Windows)."""
    try:
        hwnd = ctypes.windll.user32.GetParent(window.winfo_id())
        value = ctypes.c_int(1 if on else 0)
        for attr in (20, 19):          # DWMWA_USE_IMMERSIVE_DARK_MODE (newer, then older builds)
            if ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, attr, ctypes.byref(value), 4) == 0:
                break
        # Redraw the frame now rather than at the next focus change (SWP_NOMOVE|NOSIZE|NOZORDER|FRAMECHANGED).
        ctypes.windll.user32.SetWindowPos(hwnd, 0, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0004 | 0x0020)
    except (AttributeError, OSError):
        pass


class FormDialog(tk.Toplevel):
    """A small modal form. fields = [(label, key, is_secret, initial)]"""

    def __init__(self, parent, title, intro, fields):
        super().__init__(parent)
        self.title(title)
        self.transient(parent)
        self.resizable(False, False)
        self.result = None
        frm = ttk.Frame(self, padding=14)
        frm.pack(fill="both", expand=True)
        if intro:
            ttk.Label(frm, text=intro, wraplength=440, justify="left").grid(row=0, column=0, columnspan=2,
                                                                             sticky="w", pady=(0, 10))
        self.vars = {}
        first = None
        for i, (label, key, secret, initial) in enumerate(fields, start=1):
            ttk.Label(frm, text=label).grid(row=i, column=0, sticky="w", padx=(0, 8), pady=3)
            var = tk.StringVar(value=initial)
            entry = ttk.Entry(frm, textvariable=var, width=48, show="•" if secret else "")
            entry.grid(row=i, column=1, sticky="we", pady=3)
            self.vars[key] = var
            first = first or entry
        btns = ttk.Frame(frm)
        btns.grid(row=len(fields) + 1, column=0, columnspan=2, sticky="e", pady=(12, 0))
        ttk.Button(btns, text="Cancel", command=self.destroy).pack(side="right")
        ttk.Button(btns, text="Save", command=self._ok).pack(side="right", padx=6)
        self.bind("<Return>", lambda e: self._ok())
        self.bind("<Escape>", lambda e: self.destroy())
        _dark_title_bar(self, App.dark)
        self.grab_set()
        if first:
            first.focus_set()
        self.wait_window()

    def _ok(self):
        values = {k: v.get().strip() for k, v in self.vars.items()}
        if not all(values.values()):
            messagebox.showwarning("Missing details", "Please fill in every box.", parent=self)
            return
        self.result = values
        self.destroy()


class App:
    dark = False

    def __init__(self, root):
        self.root = root
        self.settings = config.load_settings()
        self.free_channels = []
        self.paid = {}                 # source id -> list of channels
        self.source_info = {}          # source id -> status text
        self.source_epg = {}           # source id -> guide addresses
        self.channels = {}
        self.guide = epg.Guide()
        self.health_cache = health.HealthCache()
        self.ui_queue = queue.Queue()
        self.pending_loads = 0
        self.check_cancel = threading.Event()
        self.checking = False
        self.current = None
        self.player = None
        self.fullscreen = False
        self._build()
        self.root.after(50, self._pump)
        self.root.after(200, self._init_player)
        self.root.after(300, self.reload_all)
        self.root.after(1000, self._tick)
        self.root.protocol("WM_DELETE_WINDOW", self._close)

    # --- layout -----------------------------------------------------------------------------

    def _build(self):
        root = self.root
        root.title("Waz TV")
        k = root.winfo_fpixels("1i") / 96          # 1.0 at 100 % Windows scaling, 1.5 at 150 %, ...
        root.geometry(f"{int(1280 * k)}x{int(760 * k)}")
        root.minsize(int(980 * k), int(560 * k))
        root.state("zoomed")                       # open maximised
        style = ttk.Style()
        style.theme_use("clam")                    # the built-in theme whose colours can all be changed
        style.configure("Treeview", rowheight=int(24 * k))
        style.layout("Bar.TMenubutton", [("Menubutton.border", {"sticky": "nswe", "children": [
            ("Menubutton.padding", {"sticky": "nswe", "children": [("Menubutton.label", {"sticky": ""})]})]})])
        style.configure("Bar.TMenubutton", padding=(10, 4), relief="flat", borderwidth=0)

        # Our own menu bar: Windows draws its standard one in light colours only.
        self.menubar = ttk.Frame(root, style="Bar.TFrame")
        self.menubar.pack(fill="x", side="top")
        self.menus = []

        def add_menu(label):
            btn = ttk.Menubutton(self.menubar, text=label, style="Bar.TMenubutton")
            menu = tk.Menu(btn, tearoff=False)
            btn["menu"] = menu
            btn.pack(side="left")
            self.menus.append(menu)
            return menu

        m_src = add_menu("Sources")
        m_src.add_command(label="Add paid playlist (M3U web address)…", command=self.add_m3u_url)
        m_src.add_command(label="Add paid playlist (M3U file on this PC)…", command=self.add_m3u_file)
        m_src.add_command(label="Add paid service (Xtream login)…", command=self.add_xtream)
        m_src.add_separator()
        m_src.add_command(label="Add programme guide (XMLTV address)…", command=self.add_epg)
        m_src.add_command(label="Manage my sources…", command=self.manage_sources)
        m_src.add_separator()
        m_src.add_command(label="Refresh all channel lists", command=lambda: self.reload_all(force=True))
        m_play = add_menu("Playback")
        self.buffer_var = tk.IntVar(value=self.settings["buffer_ms"])
        for ms, label in BUFFERS:
            m_play.add_radiobutton(label=f"Buffer: {label}", variable=self.buffer_var, value=ms,
                                   command=self._buffer_changed)
        m_play.add_separator()
        m_play.add_command(label="Check channels in this list now", command=self.check_visible)
        m_play.add_command(label="Full screen  (F11 / double-click video, Esc to leave)",
                           command=self.toggle_fullscreen)
        m_view = add_menu("View")
        self.dark_var = tk.BooleanVar(value=bool(self.settings.get("dark_mode")))
        m_view.add_checkbutton(label="Dark mode  (Ctrl+D)", variable=self.dark_var, command=self._dark_changed)
        m_view.add_command(label="Full screen  (F11)", command=self.toggle_fullscreen)
        m_help = add_menu("Help")
        m_help.add_command(label="About and safety", command=self.show_about)
        m_help.add_command(label="Open log folder", command=lambda: os.startfile(config.DATA_DIR))

        self.paned = ttk.Panedwindow(root, orient="horizontal")
        self.paned.pack(fill="both", expand=True)

        # left: search + groups + channel list
        self.left = ttk.Frame(self.paned, padding=(8, 8, 4, 8))
        top = ttk.Frame(self.left)
        top.pack(fill="x")
        ttk.Label(top, text="Search:").pack(side="left")
        self.search_var = tk.StringVar()
        self.search_var.trace_add("write", lambda *a: self.refresh_list())
        search = ttk.Entry(top, textvariable=self.search_var, width=26)
        search.pack(side="left", padx=(4, 10))
        self.country_var = tk.StringVar(value=ALL_COUNTRIES)
        countries = [ALL_COUNTRIES] + [f"{config.COUNTRY_NAMES.get(c, c)} ({c})" for c in self.settings["countries"]]
        cb = ttk.Combobox(top, textvariable=self.country_var, values=countries, state="readonly", width=22)
        cb.pack(side="left")
        cb.bind("<<ComboboxSelected>>", lambda e: self.refresh_list())

        body = ttk.Frame(self.left)
        body.pack(fill="both", expand=True, pady=(8, 0))
        self.group_list = tk.Listbox(body, width=18, activestyle="none", exportselection=False,
                                     font=("Segoe UI", 11), relief="flat", highlightthickness=0)
        self.group_list.pack(side="left", fill="y")
        self.group_list.bind("<<ListboxSelect>>", lambda e: self._group_selected())
        self.group = "Football"

        cols = ("fav", "name", "country", "now", "status")
        tree_frame = ttk.Frame(body)
        tree_frame.pack(side="left", fill="both", expand=True, padx=(8, 0))
        self.tree = ttk.Treeview(tree_frame, columns=cols, show="headings", selectmode="browse")
        for col, text, width, stretch in (("fav", "★", 30, False), ("name", "Channel", 210, True),
                                          ("country", "Where", 60, False), ("now", "On now", 230, True),
                                          ("status", "Status", 100, False)):
            self.tree.heading(col, text=text)
            self.tree.column(col, width=int(width * k), stretch=stretch, anchor="center" if col == "fav" else "w")
        sb = ttk.Scrollbar(tree_frame, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=sb.set)
        self.tree.pack(side="left", fill="both", expand=True)
        sb.pack(side="left", fill="y")
        self.tree.bind("<Double-1>", self._tree_double)
        self.tree.bind("<Return>", lambda e: self.play_selected())
        self.tree.bind("<Button-1>", self._tree_click)
        self.paned.add(self.left, weight=0)

        # right: video + info + controls
        self.right = ttk.Frame(self.paned, padding=(4, 8, 8, 8))
        self.video = tk.Frame(self.right, bg="black", width=640, height=360)
        self.video.pack(fill="both", expand=True)
        self.video.bind("<Double-1>", lambda e: self.toggle_fullscreen())
        self.video.bind("<Configure>", lambda e: self.player and self.player.aspect == "fill"
                        and self.player.apply_aspect())
        self.info = ttk.Frame(self.right)
        self.info.pack(fill="x", pady=(8, 0))
        self.title_var = tk.StringVar(value="Pick a channel and double-click it to watch.")
        ttk.Label(self.info, textvariable=self.title_var, font=("Segoe UI", 13, "bold")).pack(anchor="w")
        self.now_var, self.next_var = tk.StringVar(), tk.StringVar()
        ttk.Label(self.info, textvariable=self.now_var).pack(anchor="w")
        ttk.Label(self.info, textvariable=self.next_var, style="Status.TLabel").pack(anchor="w")
        ctl = ttk.Frame(self.info)
        ctl.pack(fill="x", pady=(6, 0))
        ttk.Button(ctl, text="■ Stop", command=self.stop).pack(side="left")
        self.fav_btn = ttk.Button(ctl, text="☆ Add to favourites", command=self.toggle_current_fav)
        self.fav_btn.pack(side="left", padx=6)
        ttk.Button(ctl, text="⛶ Full screen", command=self.toggle_fullscreen).pack(side="left")
        self.aspect_var = tk.StringVar(value="auto")
        self.aspect_btn = ttk.Menubutton(ctl, text="▭ Picture: Auto")
        aspect_menu = self.aspect_menu = tk.Menu(self.aspect_btn, tearoff=False)
        for mode, label in ASPECTS.items():
            aspect_menu.add_radiobutton(label=label, variable=self.aspect_var, value=mode,
                                        command=self._aspect_changed)
        self.aspect_btn["menu"] = aspect_menu
        self.aspect_btn.pack(side="left", padx=6)
        ttk.Label(ctl, text="Volume").pack(side="left", padx=(16, 4))
        self.volume = ttk.Scale(ctl, from_=0, to=100, value=self.settings["volume"], length=140,
                                command=self._volume_changed)
        self.volume.pack(side="left")
        self.play_status = tk.StringVar()
        ttk.Label(self.info, textvariable=self.play_status, style="Status.TLabel").pack(anchor="w", pady=(6, 0))
        self.paned.add(self.right, weight=1)

        self.status_var = tk.StringVar(value="Starting…")
        self.status_bar = ttk.Label(root, textvariable=self.status_var, style="Status.TLabel", padding=(8, 2),
                                    relief="sunken")
        self.status_bar.pack(fill="x", side="bottom", before=self.paned)

        root.bind("<F11>", lambda e: self.toggle_fullscreen())
        root.bind("<Control-d>", lambda e: self._toggle_dark())
        root.bind("<Escape>", lambda e: self.toggle_fullscreen() if self.fullscreen else None)
        self._fill_groups()
        self.apply_theme()
        root.after(300, lambda: _dark_title_bar(root, App.dark))   # once the window exists on screen

    # --- background work --------------------------------------------------------------------

    def run_bg(self, fn, done, failed=None):
        def worker():
            try:
                result = fn()
            except Exception as e:      # reported in the window, never crashes the app
                log.exception("background task failed")
                self.ui_queue.put((failed or self._bg_error, e))
            else:
                self.ui_queue.put((done, result))
        threading.Thread(target=worker, daemon=True).start()

    def _pump(self):
        try:
            while True:
                callback, arg = self.ui_queue.get_nowait()
                callback(arg)
        except queue.Empty:
            pass
        self.root.after(80, self._pump)

    def _bg_error(self, e):
        self.status_var.set(f"Problem: {e}")

    # --- player -----------------------------------------------------------------------------

    def _init_player(self):
        self.root.update_idletasks()
        try:
            self.player = Player(self.video.winfo_id(), self.settings["buffer_ms"], self.settings["volume"],
                                 self._player_event)
            self.player.window_size = lambda: (self.video.winfo_width(), self.video.winfo_height())
        except PlayerUnavailable as e:
            log.error("VLC unavailable: %s", e)
            messagebox.showerror(
                "VLC not found",
                "Waz TV plays video through VLC, but it couldn't find the 64-bit VLC media player.\n\n"
                "Install VLC from https://www.videolan.org (choose the 64-bit Windows version), "
                "then start Waz TV again.\n\nDetails: " + str(e))

    def _player_event(self, kind, message, channel, stream):
        if kind == "stream_dead" and stream is not None:
            stream.status = "dead"
            self.health_cache.put(stream.url, "dead")
        elif kind == "playing" and stream is not None:
            stream.status = "ok"
            self.health_cache.put(stream.url, "ok")
        elif kind == "failed" and channel is not None:
            for s in channel.streams:
                s.status = "dead"
                self.health_cache.put(s.url, "dead")
        if kind in ("stream_dead", "playing", "failed") and channel is not None:
            self._update_row(channel)
        if message:
            self.play_status.set(message)
        if kind in ("failed", "lost"):
            self.current = None

    def _tick(self):
        if self.player:
            try:
                self.player.tick()
            except Exception:
                log.exception("player tick failed")
        self._tick_count = getattr(self, "_tick_count", 0) + 1
        if self._tick_count % 30 == 0:
            self._refresh_guide_texts()
        self.root.after(1000, self._tick)

    def play_selected(self):
        sel = self.tree.selection()
        if sel and sel[0] in self.channels:
            self.play(self.channels[sel[0]])

    def play(self, channel):
        if not self.player:
            self._init_player()
            if not self.player:
                return
        self.current = channel
        where = config.COUNTRY_NAMES.get(channel.country, channel.country)
        self.title_var.set(f"{channel.name}" + (f"  ·  {where}" if where else "") + f"  ·  {channel.source}")
        self._update_fav_button()
        self._show_now_next()
        mode = self.settings["aspect"].get(channel.key, "auto")
        self.aspect_var.set(mode)
        self.aspect_btn.config(text=f"▭ Picture: {ASPECTS[mode]}")
        self.player.aspect = mode
        self.player.play(channel)

    def stop(self):
        if self.player:
            self.player.stop()
        self.current = None
        self.play_status.set("Stopped.")

    def _volume_changed(self, value):
        self.settings["volume"] = int(float(value))
        if self.player:
            self.player.set_volume(self.settings["volume"])

    def _buffer_changed(self):
        self.settings["buffer_ms"] = self.buffer_var.get()
        config.save_settings(self.settings)
        # libVLC reads its buffer size at start-up, so restart the engine with the new value.
        channel = self.current
        if self.player:
            self.player.release()
            self.player = None
        self._init_player()
        if channel:
            self.play(channel)

    def _aspect_changed(self):
        mode = self.aspect_var.get()
        self.aspect_btn.config(text=f"▭ Picture: {ASPECTS[mode]}")
        if self.current:
            if mode == "auto":
                self.settings["aspect"].pop(self.current.key, None)
            else:
                self.settings["aspect"][self.current.key] = mode
            config.save_settings(self.settings)
        if self.player:
            self.player.set_aspect(mode)

    def _dark_changed(self):
        self.settings["dark_mode"] = self.dark_var.get()
        config.save_settings(self.settings)
        self.apply_theme()

    def _toggle_dark(self):
        self.dark_var.set(not self.dark_var.get())
        self._dark_changed()

    def apply_theme(self):
        dark = App.dark = bool(self.settings.get("dark_mode"))
        c = THEMES["dark" if dark else "light"]
        style = ttk.Style()
        style.configure(".", background=c["bg"], foreground=c["fg"], fieldbackground=c["field"],
                        bordercolor=c["border"], lightcolor=c["bg"], darkcolor=c["bg"],
                        troughcolor=c["panel"], selectbackground=c["sel"], selectforeground=c["selfg"],
                        insertcolor=c["fg"], arrowcolor=c["fg"])
        style.configure("Bar.TFrame", background=c["panel"])
        style.configure("Bar.TMenubutton", background=c["panel"], foreground=c["fg"])
        style.map("Bar.TMenubutton", background=[("active", c["hover"]), ("pressed", c["hover"])])
        for widget in ("TButton", "TMenubutton"):
            style.configure(widget, background=c["panel"], foreground=c["fg"])
            style.map(widget, background=[("active", c["hover"]), ("pressed", c["sel"])])
        style.configure("TEntry", fieldbackground=c["field"], foreground=c["fg"])
        style.configure("TCombobox", fieldbackground=c["field"], background=c["panel"], foreground=c["fg"])
        style.map("TCombobox", fieldbackground=[("readonly", c["field"])], foreground=[("readonly", c["fg"])],
                  selectbackground=[("readonly", c["field"])], selectforeground=[("readonly", c["fg"])])
        style.configure("Treeview", background=c["panel"], fieldbackground=c["panel"], foreground=c["fg"])
        style.map("Treeview", background=[("selected", c["sel"])], foreground=[("selected", c["selfg"])])
        style.configure("Treeview.Heading", background=c["bg"], foreground=c["fg"], relief="flat")
        style.map("Treeview.Heading", background=[("active", c["hover"])])
        style.configure("TScrollbar", background=c["panel"], troughcolor=c["bg"], arrowcolor=c["fg"])
        style.configure("Status.TLabel", foreground=c["muted"])
        self.root.configure(bg=c["bg"])
        for opt, val in (("*TCombobox*Listbox.background", c["field"]), ("*TCombobox*Listbox.foreground", c["fg"]),
                         ("*TCombobox*Listbox.selectBackground", c["sel"]), ("*Listbox.background", c["panel"]),
                         ("*Listbox.foreground", c["fg"]), ("*Toplevel.background", c["bg"])):
            self.root.option_add(opt, val)
        self.group_list.configure(bg=c["panel"], fg=c["fg"], selectbackground=c["sel"], selectforeground=c["selfg"])
        for menu in self.menus + [self.aspect_menu]:
            menu.configure(bg=c["panel"], fg=c["fg"], activebackground=c["sel"], activeforeground=c["selfg"],
                           selectcolor=c["fg"], relief="flat", borderwidth=1)
        self.tree.tag_configure("dead", foreground=c["dead"])
        self.tree.tag_configure("ok", foreground=c["ok"])
        _dark_title_bar(self.root, dark)

    def toggle_fullscreen(self):
        self.fullscreen = not self.fullscreen
        if self.fullscreen:
            self.paned.forget(self.left)
            self.info.pack_forget()
            self.status_bar.pack_forget()
            self.menubar.pack_forget()
            self.right.configure(padding=0)
            self.root.attributes("-fullscreen", True)
        else:
            self.root.attributes("-fullscreen", False)
            self.menubar.pack(fill="x", side="top", before=self.paned)
            self.right.configure(padding=(4, 8, 8, 8))
            self.status_bar.pack(fill="x", side="bottom", before=self.paned)
            self.paned.insert(0, self.left, weight=0)
            self.info.pack(fill="x", pady=(8, 0))

    # --- loading sources ---------------------------------------------------------------------

    def reload_all(self, force=False):
        self.status_var.set("Loading channel lists…")
        self.pending_loads = 1 + len(self.settings["sources"])
        self.run_bg(lambda: sources.load_free_channels(self.settings["countries"], force),
                    self._free_loaded, self._free_failed)
        for src in self.settings["sources"]:
            self._load_source(src)

    def _load_source(self, src):
        self.source_info[src["id"]] = "loading…"
        self.run_bg(lambda: sources.load_user_source(src),
                    lambda res, s=src: self._source_loaded(s, res),
                    lambda e, s=src: self._source_failed(s, e))

    def _free_loaded(self, channels):
        self.health_cache.apply(channels)
        self.free_channels = channels
        self._rebuild()
        self.status_var.set(f"{len(channels)} free channels loaded.")
        self._load_finished()
        stale = [c for c in channels if c.status == "unknown"]
        if stale:
            self._start_check(stale, workers=12, label="free channels")

    def _free_failed(self, e):
        self.status_var.set(f"Couldn't load the free channel list ({e}). Check your internet connection, "
                            "then use Sources → Refresh.")
        self._load_finished()

    def _source_loaded(self, src, result):
        channels, epg_urls, secure = result
        self.health_cache.apply(channels)
        self.paid[src["id"]] = channels
        self.source_epg[src["id"]] = epg_urls
        lock = "encrypted (https)" if secure else "NOT encrypted – your provider doesn't offer https"
        self.source_info[src["id"]] = f"{len(channels)} channels, connection {lock}"
        self._rebuild()
        self._load_finished()

    def _source_failed(self, src, e):
        self.source_info[src["id"]] = f"failed: {e}"
        self.status_var.set(f"Couldn't load “{src['name']}”: {e}")
        self._load_finished()

    def _load_finished(self):
        self.pending_loads -= 1
        if self.pending_loads <= 0:
            self._load_guides()

    def _load_guides(self):
        jobs = [(url, False) for url in self.settings["epg_urls"] if url.lower().startswith("https://")]
        jobs += [(url, True) for url in self.settings["epg_urls"] if url.lower().startswith("http://")]
        for urls in self.source_epg.values():
            jobs += [(url, True) for url in urls]
        wanted = {epg.norm_id(c.epg_id) for c in self.channels.values() if c.epg_id}
        if not jobs or not wanted:
            return

        def work():
            merged = epg.Guide()
            for url, allow_http in jobs:
                try:
                    merged.merge(epg.parse(epg.download(url, allow_http), wanted))
                except Exception as e:
                    log.warning("Programme guide failed: %s", e)
            return merged
        self.run_bg(work, self._guide_loaded)

    def _guide_loaded(self, guide):
        self.guide = guide
        self._refresh_guide_texts()
        if guide.progs:
            self.status_var.set(f"Programme guide loaded for {len(guide.progs)} channels.")

    # --- channel list --------------------------------------------------------------------------

    def _rebuild(self):
        self.channels = {c.key: c for c in self.free_channels}
        for chs in self.paid.values():
            for c in chs:
                self.channels[c.key] = c
        self._fill_groups()
        self.refresh_list()

    def _count(self, group):
        return sum(1 for c in self.channels.values() if self._in_group(c, group))

    def _in_group(self, c, group):
        if group == "All channels":
            return True
        if group == "Favourites":
            return c.key in self.settings["favourites"]
        return group in c.groups

    def _fill_groups(self):
        self.group_list.delete(0, "end")
        self.visible_groups = [g for g in GROUPS if g != "Other" or self._count("Other")]
        for g in self.visible_groups:
            self.group_list.insert("end", f"{g}  ({self._count(g)})" if self.channels else g)
        if self.group in self.visible_groups:
            idx = self.visible_groups.index(self.group)
            self.group_list.selection_set(idx)
            self.group_list.see(idx)

    def _group_selected(self):
        sel = self.group_list.curselection()
        if sel:
            self.group = self.visible_groups[sel[0]]
            if self.search_var.get():
                self.search_var.set("")      # also refreshes
            else:
                self.refresh_list()

    def _country_code(self):
        value = self.country_var.get()
        return None if value == ALL_COUNTRIES else value[-3:-1]

    def visible_channels(self):
        query = self.search_var.get().strip().casefold()
        code = self._country_code()
        out = []
        for c in self.channels.values():
            if query:
                if query not in c.name.casefold():
                    continue
            elif not self._in_group(c, self.group):
                continue
            if code and c.country and c.country != code:
                continue
            out.append(c)
        out.sort(key=lambda c: (STATUS_RANK[c.status], c.name.casefold()))
        return out

    def refresh_list(self):
        selected = self.tree.selection()
        self.tree.delete(*self.tree.get_children())
        for c in self.visible_channels():
            self.tree.insert("", "end", iid=c.key, values=self._row(c), tags=(c.status,))
        if selected and self.tree.exists(selected[0]):
            self.tree.selection_set(selected[0])
            self.tree.see(selected[0])

    def _row(self, c):
        now, _ = self.guide.now_next(c.epg_id) if c.epg_id else (None, None)
        fav = "★" if c.key in self.settings["favourites"] else "☆"
        return (fav, c.name, c.country, now[2] if now else "", STATUS_TEXT[c.status])

    def _update_row(self, c):
        if self.tree.exists(c.key):
            self.tree.item(c.key, values=self._row(c), tags=(c.status,))

    def _refresh_guide_texts(self):
        if self.guide.progs:
            for iid in self.tree.get_children():
                c = self.channels.get(iid)
                if c:
                    self._update_row(c)
        self._show_now_next()

    def _show_now_next(self):
        c = self.current
        if not c:
            self.now_var.set("")
            self.next_var.set("")
            return
        now, nxt = self.guide.now_next(c.epg_id) if c.epg_id else (None, None)
        if now or nxt:
            self.now_var.set("Now:   " + (epg.fmt(now) or "–"))
            self.next_var.set("Next:  " + (epg.fmt(nxt) or "–"))
        else:
            self.now_var.set("No programme guide for this channel.")
            self.next_var.set("")

    def _tree_double(self, event):
        if self.tree.identify_region(event.x, event.y) == "cell":
            self.play_selected()

    def _tree_click(self, event):
        if self.tree.identify_column(event.x) == "#1" and self.tree.identify_region(event.x, event.y) == "cell":
            iid = self.tree.identify_row(event.y)
            if iid in self.channels:
                self.toggle_fav(self.channels[iid])
                return "break"

    # --- favourites ---------------------------------------------------------------------------

    def toggle_fav(self, c):
        favs = self.settings["favourites"]
        if c.key in favs:
            favs.remove(c.key)
        else:
            favs.append(c.key)
        config.save_settings(self.settings)
        self._update_row(c)
        self._fill_groups()
        if self.group == "Favourites":
            self.refresh_list()
        self._update_fav_button()

    def toggle_current_fav(self):
        if self.current:
            self.toggle_fav(self.current)

    def _update_fav_button(self):
        on = self.current is not None and self.current.key in self.settings["favourites"]
        self.fav_btn.config(text="★ In favourites" if on else "☆ Add to favourites")

    # --- health check -------------------------------------------------------------------------

    def _start_check(self, channels, workers, label):
        if self.checking:
            return
        self.checking = True
        self.check_cancel.clear()
        total = len(channels)
        self.status_var.set(f"Checking {total} {label}…")

        def progress(done, total_, ch):
            self.ui_queue.put((self._check_progress, (done, total_, ch)))

        self.run_bg(lambda: health.check_channels(channels, self.health_cache, workers, progress,
                                                  self.check_cancel),
                    lambda _r: self._check_done(label), lambda e: self._check_done(label))

    def _check_progress(self, args):
        done, total, ch = args
        self._update_row(ch)
        if done % 10 == 0 or done == total:
            self.status_var.set(f"Checking channels… {done} of {total}")

    def _check_done(self, label):
        self.checking = False
        live = sum(1 for c in self.channels.values() if c.status == "ok")
        dead = sum(1 for c in self.channels.values() if c.status == "dead")
        self.status_var.set(f"Check finished: {live} channels live, {dead} offline (offline ones are greyed "
                            "out at the bottom of each list).")
        self.refresh_list()

    def check_visible(self):
        chans = self.visible_channels()
        if not chans:
            return
        if self.checking:
            messagebox.showinfo("Already checking", "A channel check is already running.")
            return
        free = [c for c in chans if c.free]
        paid = [c for c in chans if not c.free]
        if paid and not messagebox.askyesno(
                "Check paid channels?",
                f"This list has {len(paid)} channels from your paid service. Many services only allow one "
                "or two connections at a time, so Waz TV will check them slowly, one at a time. "
                "Continue?"):
            paid = []
        if free:
            self._start_check(free, 12, "channels")
        elif paid:
            self._start_check(paid, 1, "paid channels")

    # --- adding sources -----------------------------------------------------------------------

    def _add_source(self, src):
        self.settings["sources"].append(src)
        config.save_settings(self.settings)
        self.pending_loads += 1
        self._load_source(src)
        self.status_var.set(f"Loading “{src['name']}”…")

    def add_m3u_url(self):
        d = FormDialog(self.root, "Add paid playlist",
                       "Paste the M3U playlist address your provider gave you. It is stored encrypted "
                       "with your Windows account and never sent anywhere except your provider.",
                       [("Name", "name", False, "My TV service"), ("Playlist address", "url", True, "")])
        if not d.result:
            return
        if not netutil.is_web_url(d.result["url"]):
            messagebox.showerror("Not a web address", "The address must start with https:// or http://")
            return
        self._add_source({"id": uuid.uuid4().hex[:8], "type": "m3u_url", "name": d.result["name"],
                          "secret": config.protect({"url": d.result["url"]})})

    def add_m3u_file(self):
        path = filedialog.askopenfilename(title="Choose your playlist file",
                                          filetypes=[("Playlists", "*.m3u *.m3u8"), ("All files", "*.*")])
        if path:
            name = os.path.splitext(os.path.basename(path))[0]
            self._add_source({"id": uuid.uuid4().hex[:8], "type": "m3u_file", "name": name, "path": path})

    def add_xtream(self):
        d = FormDialog(self.root, "Add paid service (Xtream)",
                       "Enter the server address, username and password from your provider. They are "
                       "stored encrypted with your Windows account. Waz TV tries an encrypted (https) "
                       "connection first.",
                       [("Name", "name", False, "My TV service"), ("Server address", "server", False, ""),
                        ("Username", "username", False, ""), ("Password", "password", True, "")])
        if d.result:
            secret = {k: d.result[k] for k in ("server", "username", "password")}
            self._add_source({"id": uuid.uuid4().hex[:8], "type": "xtream", "name": d.result["name"],
                              "secret": config.protect(secret)})

    def add_epg(self):
        d = FormDialog(self.root, "Add programme guide",
                       "Paste an XMLTV guide address (ending in .xml or .xml.gz). Paid services usually "
                       "provide their guide automatically, so you only need this for extra guides.",
                       [("Guide address", "url", False, "")])
        if d.result:
            if not netutil.is_web_url(d.result["url"]):
                messagebox.showerror("Not a web address", "The address must start with https:// or http://")
                return
            self.settings["epg_urls"].append(d.result["url"])
            config.save_settings(self.settings)
            self._load_guides()

    def manage_sources(self):
        win = tk.Toplevel(self.root)
        win.title("My sources")
        win.transient(self.root)
        win.after(10, lambda: _dark_title_bar(win, App.dark))
        frm = ttk.Frame(win, padding=12)
        frm.pack(fill="both", expand=True)
        ttk.Label(frm, text="Free (iptv-org): always included, filtered to legitimate free channels.").pack(anchor="w")
        lb = tk.Listbox(frm, width=90, height=10)
        lb.pack(fill="both", expand=True, pady=8)
        items = []
        for src in self.settings["sources"]:
            kind = {"m3u_url": "M3U address", "m3u_file": "M3U file", "xtream": "Xtream"}[src["type"]]
            lb.insert("end", f"{src['name']}  [{kind}]  –  {self.source_info.get(src['id'], '')}")
            items.append(("source", src))
        for url in self.settings["epg_urls"]:
            lb.insert("end", f"Programme guide: {url}")
            items.append(("epg", url))

        def remove():
            sel = lb.curselection()
            if not sel:
                return
            kind, item = items[sel[0]]
            if not messagebox.askyesno("Remove", "Remove this source from Waz TV?", parent=win):
                return
            if kind == "source":
                self.settings["sources"].remove(item)
                self.paid.pop(item["id"], None)
                self.source_epg.pop(item["id"], None)
                prefix = item["id"] + ":"
                self.settings["favourites"] = [k for k in self.settings["favourites"] if not k.startswith(prefix)]
            else:
                self.settings["epg_urls"].remove(item)
            config.save_settings(self.settings)
            lb.delete(sel[0])
            items.pop(sel[0])
            self._rebuild()
        ttk.Button(frm, text="Remove selected", command=remove).pack(side="left")
        ttk.Button(frm, text="Close", command=win.destroy).pack(side="right")

    def show_about(self):
        messagebox.showinfo(
            "About Waz TV",
            "Waz TV plays TV streams through VLC's official playback engine.\n\n"
            "• No ads, no tracking, no accounts. It only contacts: the iptv-org channel list "
            "(github.io), the TV streams you play or check, and any paid service or guide you add.\n"
            "• It never downloads or runs programs. Playlists are read as plain text; only channel names "
            "and video addresses are used.\n"
            "• Free channels are filtered: pay-TV sports brands, bare IP addresses, unencrypted links and "
            "known restream hosts are removed.\n"
            "• Your paid-service details are encrypted with your Windows account.\n\n"
            f"Settings and log: {config.DATA_DIR}")

    def _close(self):
        self.check_cancel.set()
        try:
            config.save_settings(self.settings)
            self.health_cache.save()
            if self.player:
                self.player.release()
        finally:
            self.root.destroy()
