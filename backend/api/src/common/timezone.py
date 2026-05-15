from datetime import datetime
from typing import Optional

try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None  # Python < 3.9 fallback


def get_tz_offset_hours(tz_name: str) -> float:
    """Return current UTC offset in hours for an IANA timezone name. Falls back to 0.0."""
    if not tz_name or not ZoneInfo:
        return 0.0
    try:
        tz = ZoneInfo(tz_name)
        offset = datetime.now(tz).utcoffset()
        return offset.total_seconds() / 3600.0 if offset else 0.0
    except Exception:
        return 0.0
