from __future__ import annotations

import json
import traceback
from typing import TYPE_CHECKING
from urllib.parse import urlparse

import httpx

from .config import API_BASE_URL
from .types import ErrorReport, EventPayload, RequestAdapter

if TYPE_CHECKING:
    from . import WorkerCore

JSON_HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json",
}


def build_event_payload(
    adapter: RequestAdapter,
    status_code: int,
    request_id: str,
    payment_response: str | None = None,
) -> EventPayload:
    url = urlparse(adapter.get_url())

    payload = EventPayload(
        method=adapter.get_method(),
        status_code=status_code,
        user_agent=adapter.get_user_agent() or None,
        referer=adapter.get_header("referer") or None,
        href=adapter.get_url(),
        hostname=url.hostname or "",
        pathname=url.path,
        search=url.query or "",
        ip_address=adapter.get_ip_address(),
        request_id=request_id,
    )
    if payment_response:
        payload.payment_response = payment_response
    return payload


async def send_event(api_key: str, payload: EventPayload) -> None:
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                f"{API_BASE_URL}/v1/events",
                headers={"Authorization": f"Bearer {api_key}", **JSON_HEADERS},
                json={
                    "method": payload.method,
                    "status_code": payload.status_code,
                    "user_agent": payload.user_agent,
                    "referer": payload.referer,
                    "href": payload.href,
                    "hostname": payload.hostname,
                    "pathname": payload.pathname,
                    "search": payload.search,
                    "ip_address": payload.ip_address,
                    "request_id": payload.request_id,
                    "payment_response": payload.payment_response,
                },
            )
    except Exception:
        pass


async def report_error(
    api_key: str,
    error: BaseException,
    adapter: RequestAdapter | None = None,
) -> None:
    payload: dict = {
        "error": str(error),
        "stack": traceback.format_exception(error),
    }

    if adapter:
        payload["context"] = {
            "method": adapter.get_method(),
            "path": adapter.get_path(),
            "hostname": adapter.get_host(),
            "user_agent": adapter.get_user_agent() or None,
            "ip_address": adapter.get_ip_address(),
        }

    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                f"{API_BASE_URL}/v1/errors",
                headers={"Authorization": f"Bearer {api_key}", **JSON_HEADERS},
                json=payload,
            )
    except Exception:
        pass


async def log_event(
    core: WorkerCore,
    adapter: RequestAdapter,
    status_code: int,
    request_id: str,
    payment_response: str | None = None,
) -> None:
    payload = build_event_payload(adapter, status_code, request_id, payment_response)
    await send_event(core.api_key, payload)
