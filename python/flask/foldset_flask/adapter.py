from __future__ import annotations

from typing import Any

from flask import Request
from foldset.types import RequestAdapter


class FlaskAdapter(RequestAdapter):
    def __init__(self, request: Request) -> None:
        self._request = request

    def get_ip_address(self) -> str | None:
        forwarded = self.get_header("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return self._request.remote_addr

    def get_header(self, name: str) -> str | None:
        return self._request.headers.get(name)

    def get_method(self) -> str:
        return self._request.method

    def get_path(self) -> str:
        return self._request.path

    def get_url(self) -> str:
        return self._request.url

    def get_host(self) -> str:
        return self._request.host.split(":")[0]

    def get_accept_header(self) -> str:
        return self.get_header("Accept") or ""

    def get_user_agent(self) -> str:
        return self.get_header("User-Agent") or ""

    def get_query_params(self) -> dict[str, str | list[str]] | None:
        result: dict[str, str | list[str]] = {}
        for key in self._request.args:
            values = self._request.args.getlist(key)
            result[key] = values if len(values) > 1 else values[0]
        return result

    def get_query_param(self, name: str) -> str | list[str] | None:
        values = self._request.args.getlist(name)
        if not values:
            return None
        return values if len(values) > 1 else values[0]

    async def get_body(self) -> Any:
        return self._request.get_json(silent=True)
