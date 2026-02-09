from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from x402.http import HTTPAdapter, HTTPProcessResult


class RequestAdapter(HTTPAdapter):
    """Extends x402 HTTPAdapter with Foldset-specific methods."""

    def get_ip_address(self) -> str | None: ...
    def get_host(self) -> str: ...
    async def get_body(self) -> Any: ...


@dataclass
class FoldsetOptions:
    api_key: str
    redis_credentials: RedisCredentials | None = None
    platform: str | None = None
    sdk_version: str | None = None


@dataclass
class RedisCredentials:
    url: str
    token: str
    tenant_id: str


@dataclass
class RequestMetadata:
    version: str
    request_id: str
    timestamp: str


@dataclass
class HostConfig:
    host: str
    api_protection_mode: Literal["bots", "all"]
    mcp_endpoint: str | None = None
    terms_of_service_url: str | None = None


@dataclass
class RestrictionBase:
    description: str
    price: float
    scheme: str


@dataclass
class WebRestriction(RestrictionBase):
    type: Literal["web"] = "web"
    path: str = ""


@dataclass
class ApiRestriction(RestrictionBase):
    type: Literal["api"] = "api"
    path: str = ""
    http_method: str | None = None


@dataclass
class McpRestriction(RestrictionBase):
    type: Literal["mcp"] = "mcp"
    method: str = ""
    name: str = ""


Restriction = WebRestriction | ApiRestriction | McpRestriction


@dataclass
class PaymentMethod:
    caip2_id: str
    decimals: int
    contract_address: str
    circle_wallet_address: str
    chain_display_name: str
    asset_display_name: str
    extra: dict[str, str] | None = None


@dataclass
class Bot:
    user_agent: str
    force_200: bool = False


@dataclass
class FacilitatorConfig:
    url: str
    verify_headers: dict[str, str] | None = None
    settle_headers: dict[str, str] | None = None
    supported_headers: dict[str, str] | None = None


@dataclass
class HttpServerResult:
    type: Literal["no-payment-required", "payment-error", "payment-verified"]
    metadata: RequestMetadata
    restriction: Restriction | None = None
    response: Any | None = None
    payment_payload: Any | None = None
    payment_requirements: Any | None = None
    headers: dict[str, str] | None = None


@dataclass
class ProcessRequestResult:
    type: Literal["no-payment-required", "payment-error", "payment-verified", "health-check"]
    metadata: RequestMetadata
    restriction: Restriction | None = None
    response: Any | None = None
    payment_payload: Any | None = None
    payment_requirements: Any | None = None
    headers: dict[str, str] | None = None


class ConfigStore(Protocol):
    async def get(self, key: str) -> str | None: ...


@dataclass
class EventPayload:
    method: str
    status_code: int
    user_agent: str | None
    href: str
    hostname: str
    pathname: str
    search: str
    request_id: str
    referer: str | None = None
    ip_address: str | None = None
    payment_response: str | None = None


@dataclass
class ErrorReport:
    error: str
    stack: str | None = None
    context: dict[str, Any] | None = None
