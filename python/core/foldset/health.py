from __future__ import annotations

import json
from datetime import datetime, timezone

from .config import PACKAGE_VERSION

HEALTH_PATH = "/.well-known/foldset"


def build_health_response(platform: str, sdk_version: str) -> str:
    return json.dumps({
        "status": "ok",
        "core_version": PACKAGE_VERSION,
        "sdk_version": sdk_version,
        "platform": platform,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
