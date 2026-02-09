from __future__ import annotations

from typing import Any

from foldset.types import RequestAdapter
from starlette.requests import Request


class FastAPIAdapter(RequestAdapter):
    def __init__(self, request: Request) -> None:
        self._request = request
        self._body: Any | None = None

    def get_ip_address(self) -> str | None:
        forwarded = self.get_header("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        if self._request.client:
            return self._request.client.host
        return None

    def get_header(self, name: str) -> str | None:
        return self._request.headers.get(name)

    def get_method(self) -> str:
        return self._request.method

    def get_path(self) -> str:
        return self._request.url.path

    def get_url(self) -> str:
        return str(self._request.url)

    def get_host(self) -> str:
        return self._request.url.hostname or ""

    def get_accept_header(self) -> str:
        return self.get_header("accept") or ""

    def get_user_agent(self) -> str:
        return self.get_header("user-agent") or ""

    def get_query_params(self) -> dict[str, str | list[str]] | None:
        result: dict[str, str | list[str]] = {}
        for key, value in self._request.query_params.multi_items():
            existing = result.get(key)
            if existing is None:
                result[key] = value
            elif isinstance(existing, list):
                existing.append(value)
            else:
                result[key] = [existing, value]
        return result

    def get_query_param(self, name: str) -> str | list[str] | None:
        params = self.get_query_params()
        if params:
            return params.get(name)
        return None

    async def get_body(self) -> Any:
        if self._body is None:
            try:
                self._body = await self._request.json()
            except Exception:
                self._body = None
        return self._body
