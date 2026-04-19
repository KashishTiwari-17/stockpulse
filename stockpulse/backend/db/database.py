"""
Database layer — async SQLite via aiosqlite.
Stores OHLC candles and user alerts.
"""

import aiosqlite
import logging
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "stockpulse.db"
logger = logging.getLogger(__name__)


async def init_db():
    """Create tables on startup if they don't exist."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS candles (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker    TEXT    NOT NULL,
                ts        TEXT    NOT NULL,
                open      REAL    NOT NULL,
                high      REAL    NOT NULL,
                low       REAL    NOT NULL,
                close     REAL    NOT NULL,
                volume    REAL    DEFAULT 0,
                UNIQUE(ticker, ts)
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS alerts (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker      TEXT    NOT NULL,
                threshold   REAL    NOT NULL,
                direction   TEXT    NOT NULL CHECK(direction IN ('above','below')),
                triggered   INTEGER DEFAULT 0,
                created_at  TEXT    DEFAULT (datetime('now'))
            )
        """)
        await db.execute("CREATE INDEX IF NOT EXISTS idx_candles_ticker ON candles(ticker, ts)")
        await db.commit()
    logger.info("Database tables ready at %s", DB_PATH)


async def save_candle(ticker: str, candle: dict):
    """Upsert a single OHLC candle."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            INSERT INTO candles (ticker, ts, open, high, low, close, volume)
            VALUES (:ticker, :ts, :open, :high, :low, :close, :volume)
            ON CONFLICT(ticker, ts) DO UPDATE SET
                open=excluded.open, high=excluded.high,
                low=excluded.low,  close=excluded.close,
                volume=excluded.volume
        """, {"ticker": ticker, **candle})
        await db.commit()


async def get_candles(ticker: str, limit: int = 200) -> list[dict]:
    """Fetch last N candles for a ticker."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("""
            SELECT ts, open, high, low, close, volume
            FROM candles
            WHERE ticker = ?
            ORDER BY ts DESC
            LIMIT ?
        """, (ticker, limit)) as cur:
            rows = await cur.fetchall()
    return [dict(r) for r in reversed(rows)]


async def create_alert(ticker: str, threshold: float, direction: str) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("""
            INSERT INTO alerts (ticker, threshold, direction)
            VALUES (?, ?, ?)
        """, (ticker, threshold, direction))
        await db.commit()
        return cur.lastrowid


async def get_active_alerts() -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM alerts WHERE triggered = 0"
        ) as cur:
            rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def mark_alert_triggered(alert_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE alerts SET triggered=1 WHERE id=?", (alert_id,))
        await db.commit()
