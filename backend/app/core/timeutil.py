"""Time zones.

Windows has no built-in time zone database, so Python reads it from the
`tzdata` package (in requirements.txt). If that's ever missing, fall back to
a fixed offset instead of crashing; Sri Lanka has no daylight saving, so
+05:30 is always right for Asia/Colombo.
"""

import logging
from datetime import timedelta, timezone, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

log = logging.getLogger(__name__)

_FIXED = {"Asia/Colombo": timezone(timedelta(hours=5, minutes=30), "Asia/Colombo"), "UTC": timezone.utc}


def business_tz(name: str) -> tzinfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        log.warning("Time zone %r not found; install the tzdata package. Using a fixed offset.", name)
        return _FIXED.get(name, timezone.utc)
