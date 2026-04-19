"""
Structured logging — JSON format for production, pretty for development.
"""

import logging
import sys
import os


def setup_logging():
    level = logging.DEBUG if os.getenv("DEBUG", "false").lower() == "true" else logging.INFO

    fmt = "%(asctime)s [%(levelname)s] %(name)s — %(message)s"
    datefmt = "%Y-%m-%d %H:%M:%S"

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(fmt, datefmt))

    root = logging.getLogger()
    root.setLevel(level)
    root.addHandler(handler)

    # Silence noisy libs
    for lib in ("yfinance", "urllib3", "httpx", "asyncio"):
        logging.getLogger(lib).setLevel(logging.WARNING)
