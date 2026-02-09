from __future__ import annotations

import json
from typing import Any

from django.http import HttpRequest
from foldset.types import RequestAdapter


class DjangoAdapter(RequestAdapter):
    def __init__(self, request: HttpRequest) -> None:
        self._request = request

    def get_ip_address(self) -> str | None:
        forwarded = self.get_header("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return self._request.META.get("REMOTE_ADDR")

    def get_header(self, name: str) -> str | None:
        # Django stores headers in META as HTTP_<UPPER_UNDERSCORE>
        # except Content-Type and Content-Length
        meta_key = "HTTP_" + name.upper().replace("-", "_")
        value = self._request.META.get(meta_key)
        if value is None:
            # Try without HTTP_ prefix for Content-Type / Content-Length
            value = self._request.META.get(name.upper().replace("-", "_"))
        return value

    def get_method(self) -> str:
        return self._request.method or "GET"

    def get_path(self) -> str:
        return self._request.path

    def get_url(self) -> str:
        return self._request.build_absolute_uri()

    def get_host(self) -> str:
        return self._request.get_host().split(":")[0]

    def get_accept_header(self) -> str:
        return self.get_header("Accept") or ""

    def get_user_agent(self) -> str:
        return self.get_header("User-Agent") or ""

    def get_query_params(self) -> dict[str, str | list[str]] | None:
        result: dict[str, str | list[str]] = {}
        for key in self._request.GET:
            values = self._request.GET.getlist(key)
            result[key] = values if len(values) > 1 else values[0]
        return result

    def get_query_param(self, name: str) -> str | list[str] | None:
        values = self._request.GET.getlist(name)
        if not values:
            return None
        return values if len(values) > 1 else values[0]

    async def get_body(self) -> Any:
        try:
            return json.loads(self._request.body)
        except Exception:
            return None
