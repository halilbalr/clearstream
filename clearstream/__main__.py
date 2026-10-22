"""Start Clearstream:  python -m clearstream"""
import ctypes
import logging
import logging.handlers
import tkinter as tk

from . import config


def main():
    config.ensure_dirs()
    handler = logging.handlers.RotatingFileHandler(config.LOG_PATH, maxBytes=1_000_000, backupCount=2,
                                                   encoding="utf-8")
    logging.basicConfig(level=logging.INFO, handlers=[handler],
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)   # sharp text on high-resolution screens
    except (AttributeError, OSError):
        pass
    from .ui import App
    root = tk.Tk()
    # Without a console, Tk would print errors from timers and clicks to nowhere; log them instead.
    root.report_callback_exception = lambda *exc: logging.getLogger("clearstream").error(
        "Error in the window", exc_info=exc)
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
