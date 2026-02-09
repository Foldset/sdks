from __future__ import annotations

import json
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from x402.http import FacilitatorConfig as X402FacilitatorConfig
from x402.http import HTTPFacilitatorClient

from .types import (
    Bot,
    ConfigStore,
    FacilitatorConfig,
    HostConfig,
    PaymentMethod,
    ProcessRequestResult,
    RequestMetadata,
    Restriction,
    ApiRestriction,
    McpRestriction,
    WebRestriction,
)

from importlib.metadata import version as _pkg_version

PACKAGE_VERSION = _pkg_version("foldset")
CACHE_TTL_MS = 30_000
API_BASE_URL = "https://api.foldset.com"


def build_request_metadata() -> RequestMetadata:
    return RequestMetadata(
        version=PACKAGE_VERSION,
        request_id=str(uuid.uuid4()),
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


def no_payment_required(metadata: RequestMetadata) -> ProcessRequestResult:
    return ProcessRequestResult(type="no-payment-required", metadata=metadata)


class CachedConfigManager[T]:
    def __init__(self, config_store: ConfigStore, key: str, fallback: T) -> None:
        self._config_store = config_store
        self._key = key
        self._fallback = fallback
        self._cached: T = fallback
        self._cache_timestamp: float = 0

    def _is_cache_valid(self) -> bool:
        return self._cache_timestamp > 0 and (time.time() * 1000 - self._cache_timestamp) < CACHE_TTL_MS

    def _deserialize(self, raw: str) -> T:
        return json.loads(raw)

    async def get(self) -> T:
        if self._is_cache_valid():
            return self._cached
        raw = await self._config_store.get(self._key)
        self._cached = self._deserialize(raw) if raw else self._fallback
        self._cache_timestamp = time.time() * 1000
        return self._cached


def _parse_restriction(data: dict[str, Any]) -> Restriction:
    rtype = data.get("type")
    if rtype == "web":
        return WebRestriction(
            description=data["description"],
            price=data["price"],
            scheme=data["scheme"],
            path=data.get("path", ""),
        )
    elif rtype == "api":
        return ApiRestriction(
            description=data["description"],
            price=data["price"],
            scheme=data["scheme"],
            path=data.get("path", ""),
            http_method=data.get("httpMethod"),
        )
    elif rtype == "mcp":
        return McpRestriction(
            description=data["description"],
            price=data["price"],
            scheme=data["scheme"],
            method=data.get("method", ""),
            name=data.get("name", ""),
        )
    raise ValueError(f"Unknown restriction type: {rtype}")


class HostConfigManager(CachedConfigManager[HostConfig | None]):
    def __init__(self, store: ConfigStore) -> None:
        super().__init__(store, "host-config", None)

    def _deserialize(self, raw: str) -> HostConfig | None:
        data = json.loads(raw)
        return HostConfig(
            host=data["host"],
            api_protection_mode=data.get("apiProtectionMode", "bots"),
            mcp_endpoint=data.get("mcpEndpoint"),
            terms_of_service_url=data.get("termsOfServiceUrl"),
        )


class RestrictionsManager(CachedConfigManager[list[Restriction]]):
    def __init__(self, store: ConfigStore) -> None:
        super().__init__(store, "restrictions", [])

    def _deserialize(self, raw: str) -> list[Restriction]:
        data = json.loads(raw)
        return [_parse_restriction(r) for r in data]


class PaymentMethodsManager(CachedConfigManager[list[PaymentMethod]]):
    def __init__(self, store: ConfigStore) -> None:
        super().__init__(store, "payment-methods", [])

    def _deserialize(self, raw: str) -> list[PaymentMethod]:
        data = json.loads(raw)
        return [
            PaymentMethod(
                caip2_id=pm["caip2_id"],
                decimals=pm["decimals"],
                contract_address=pm["contract_address"],
                circle_wallet_address=pm["circle_wallet_address"],
                chain_display_name=pm["chain_display_name"],
                asset_display_name=pm["asset_display_name"],
                extra=pm.get("extra"),
            )
            for pm in data
        ]


class BotsManager(CachedConfigManager[list[Bot]]):
    def __init__(self, store: ConfigStore) -> None:
        super().__init__(store, "bots", [])

    def _deserialize(self, raw: str) -> list[Bot]:
        data = json.loads(raw)
        return [
            Bot(
                user_agent=b["user_agent"].lower(),
                force_200=b.get("force_200", False),
            )
            for b in data
        ]

    async def match_bot(self, user_agent: str) -> Bot | None:
        bots = await self.get()
        ua = user_agent.lower()
        for bot in bots:
            if bot.user_agent in ua:
                return bot
        return None


class FacilitatorManager(CachedConfigManager[HTTPFacilitatorClient | None]):
    def __init__(self, store: ConfigStore) -> None:
        super().__init__(store, "facilitator", None)

    def _deserialize(self, raw: str) -> HTTPFacilitatorClient:
        config = json.loads(raw)

        has_auth_headers = (
            config.get("verifyHeaders")
            or config.get("settleHeaders")
            or config.get("supportedHeaders")
        )

        facilitator_config: dict[str, Any] = {"url": config["url"]}
        if has_auth_headers:
            facilitator_config["create_headers"] = lambda: {
                "verify": config.get("verifyHeaders") or {},
                "settle": config.get("settleHeaders") or {},
                "supported": config.get("supportedHeaders") or {},
            }

        return HTTPFacilitatorClient(facilitator_config)
