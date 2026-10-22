"""Entry point used when building Clearstream.exe (PyInstaller needs a script, not a package)."""
from clearstream.__main__ import main

if __name__ == "__main__":
    main()
