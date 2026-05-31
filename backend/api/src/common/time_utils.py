from __future__ import annotations

from datetime import date as _date
from datetime import datetime, timedelta, timezone
from typing import Optional, Set


def parse_naive_utc(s: str) -> Optional[datetime]:
    """Parse any ISO datetime string to a naive UTC datetime.

    Handles Z suffix, +HH:MM offsets, and plain naive strings.
    Returns None for date-only (all-day) strings.
    """
    if not s:
        return None
    s = str(s).strip()
    if len(s) == 10:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except Exception:
        return None


def collect_all_day_dates(busy_list: list) -> Set[_date]:
    """Return calendar dates fully blocked by all-day events (duration >= 22 h).

    Google all-day events appear as midnight-to-midnight UTC blocks after
    normalisation. Multi-day blocks have duration that is a multiple of 24 h.
    The 22-hour threshold lets DST edge cases through.
    """
    blocked: Set[_date] = set()
    for b in busy_list:
        b_start = parse_naive_utc(b.get("start", ""))
        b_end = parse_naive_utc(b.get("end", ""))
        if b_start is None or b_end is None:
            continue
        if (b_end - b_start) >= timedelta(hours=22):
            d = b_start.date()
            while d < b_end.date():
                blocked.add(d)
                d += timedelta(days=1)
    return blocked
