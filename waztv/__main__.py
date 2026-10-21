"""Start Waz TV:  python -m waztv"""
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
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
