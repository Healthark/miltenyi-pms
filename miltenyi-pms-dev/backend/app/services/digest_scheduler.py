"""
digest_scheduler — the in-process job that sends the daily summary emails.

Zaahid's call (26 Sep 2026): no external cron; the API process runs the job
itself. It is one asyncio task started from the FastAPI lifespan: sleep until
the next weekday send time in the org's timezone (System Settings → timezone),
run `run_daily_digests` in a worker thread on its own DB session, repeat.

Guards:
  * `DIGEST_ENABLED=false` in .env switches the task off entirely.
  * SMTP unconfigured → the run is a no-op (checked before any slot is claimed).
  * `daily_digest_log` makes a second run on the same day (restart, a second
    instance, the Admin's "send now") send nothing.
  * Any exception is logged and the loop continues; the job never takes the
    API down.

More than one backend instance means more than one scheduler; the unique
index keeps the mail count right, they just race for the same slot.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, time, timedelta
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.core.config import settings

logger = logging.getLogger(__name__)


def org_timezone_name() -> str:
    """The org's timezone from System Settings; UTC when unset."""
    from app.core.database import SessionLocal
    from app.models.system_settings_models import SystemSettings

    try:
        with SessionLocal() as db:
            row = db.query(SystemSettings.timezone).order_by(SystemSettings.org_id).first()
            return (row[0] if row and row[0] else "UTC")
    except Exception:  # pragma: no cover - a DB hiccup must not kill the loop
        logger.exception("Could not read the org timezone; using UTC for the digest schedule.")
        return "UTC"


def _zone(name: str):
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, Exception):
        logger.warning("Unknown timezone %r for the digest schedule; using UTC.", name)
        return ZoneInfo("UTC")


def next_run_at(now: datetime) -> datetime:
    """The next send moment at or after `now` (tz-aware, in now's zone):
    DIGEST_HOUR:DIGEST_MINUTE on the next allowed day (weekdays only unless
    DIGEST_WEEKDAYS_ONLY is off)."""
    at = time(hour=settings.DIGEST_HOUR, minute=settings.DIGEST_MINUTE)
    candidate = datetime.combine(now.date(), at, tzinfo=now.tzinfo)
    if candidate <= now:
        candidate += timedelta(days=1)
    while settings.DIGEST_WEEKDAYS_ONLY and candidate.weekday() >= 5:
        candidate += timedelta(days=1)
    return candidate


def schedule_description(tz_name: str) -> str:
    when = f"{settings.DIGEST_HOUR:02d}:{settings.DIGEST_MINUTE:02d} ({tz_name})"
    return f"{'Weekdays' if settings.DIGEST_WEEKDAYS_ONLY else 'Every day'} at {when}"


def run_once() -> dict:
    """One synchronous run on a fresh session (called from a worker thread)."""
    from app.core.database import SessionLocal
    from app.services.daily_digests import run_daily_digests

    with SessionLocal() as db:
        result = run_daily_digests(db)
    logger.info(
        "Daily summary emails: %s mentor, %s staff, %s already sent today%s.",
        result["mentor"], result["staff"], result["skipped_already_sent"],
        " (SMTP not configured — nothing sent)" if result.get("skipped_no_smtp") else "",
    )
    return result


class DigestScheduler:
    def __init__(self) -> None:
        self._task: Optional[asyncio.Task] = None

    async def _loop(self) -> None:
        while True:
            tz = _zone(await asyncio.to_thread(org_timezone_name))
            now = datetime.now(tz)
            target = next_run_at(now)
            delay = max(1.0, (target - now).total_seconds())
            logger.info("Next daily summary run at %s (%s).", target.isoformat(timespec="minutes"), tz.key)
            try:
                await asyncio.sleep(delay)
                await asyncio.to_thread(run_once)
            except asyncio.CancelledError:
                raise
            except Exception:  # pragma: no cover - keep the loop alive
                logger.exception("Daily summary run failed; will try again at the next slot.")
                await asyncio.sleep(60)

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop(), name="daily-digests")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()


digest_scheduler = DigestScheduler()
