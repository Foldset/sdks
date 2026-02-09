from __future__ import annotations

from .config import (
    BotsManager,
    CachedConfigManager,
    FacilitatorManager,
    HostConfigManager,
    PaymentMethodsManager,
    RestrictionsManager,
    build_request_metadata,
)
from .handler import handle_request, handle_settlement
from .health import HEALTH_PATH, build_health_response
from .mcp import handle_mcp_request
from .server import HttpServerManager
from .store import create_redis_store, fetch_redis_credentials
from .types import (
    ConfigStore,
    FoldsetOptions,
    ProcessRequestResult,
    RedisCredentials,
    RequestAdapter,
)

_cached_core: WorkerCore | None = None


class WorkerCore:
    def __init__(
        self,
        store: ConfigStore,
        api_key: str,
        platform: str,
        sdk_version: str,
    ) -> None:
        self.host_config = HostConfigManager(store)
        self.restrictions = RestrictionsManager(store)
        self.payment_methods = PaymentMethodsManager(store)
        self.bots = BotsManager(store)
        self.api_key = api_key
        self.http_server = HttpServerManager(store)
        self.platform = platform
        self.sdk_version = sdk_version

    @classmethod
    async def from_options(cls, options: FoldsetOptions) -> WorkerCore:
        global _cached_core
        if _cached_core:
            return _cached_core

        credentials = options.redis_credentials or await fetch_redis_credentials(
            options.api_key
        )
        store = create_redis_store(credentials)
        _cached_core = cls(
            store,
            options.api_key,
            options.platform or "unknown",
            options.sdk_version or "unknown",
        )
        return _cached_core

    async def process_request(self, adapter: RequestAdapter) -> ProcessRequestResult:
        metadata = build_request_metadata()

        if adapter.get_path() == HEALTH_PATH:
            return ProcessRequestResult(
                type="health-check",
                metadata=metadata,
                response=type(
                    "HealthResponse",
                    (),
                    {
                        "status": 200,
                        "body": build_health_response(self.platform, self.sdk_version),
                        "headers": {"Content-Type": "application/json"},
                    },
                )(),
            )

        host_config = await self.host_config.get()
        mcp_endpoint = host_config.mcp_endpoint if host_config else None

        if mcp_endpoint and adapter.get_path() == mcp_endpoint:
            return await handle_mcp_request(self, adapter, mcp_endpoint, metadata)

        return await handle_request(self, adapter, metadata)

    async def process_settlement(
        self,
        adapter: RequestAdapter,
        payment_payload,
        payment_requirements,
        upstream_status_code: int,
        request_id: str,
    ):
        return await handle_settlement(
            self,
            adapter,
            payment_payload,
            payment_requirements,
            upstream_status_code,
            request_id,
        )


# Re-exports
__all__ = [
    "WorkerCore",
    # Types
    "ConfigStore",
    "FoldsetOptions",
    "ProcessRequestResult",
    "RedisCredentials",
    "RequestAdapter",
    # Store
    "create_redis_store",
    "fetch_redis_credentials",
    # Paywall
    "generate_paywall_html",
    # Routes
    "build_routes_config",
    "price_to_amount",
    # Config managers
    "BotsManager",
    "CachedConfigManager",
    "FacilitatorManager",
    "HostConfigManager",
    "PaymentMethodsManager",
    "RestrictionsManager",
    # Server
    "HttpServerManager",
    # MCP
    "build_json_rpc_error",
    "build_mcp_route_key",
    "build_mcp_routes_config",
    "get_mcp_list_payment_requirements",
    "get_mcp_route_key",
    "handle_mcp_request",
    "is_mcp_list_method",
    "parse_mcp_request",
    # Telemetry
    "build_event_payload",
    "log_event",
    "report_error",
    "send_event",
    # Handlers
    "handle_request",
    "handle_settlement",
    "format_api_payment_error",
    "format_web_payment_error",
    # Health
    "HEALTH_PATH",
    "build_health_response",
]

# Lazy imports for __all__ items
from .paywall import generate_paywall_html  # noqa: E402
from .routes import build_routes_config, price_to_amount  # noqa: E402
from .mcp import (  # noqa: E402
    build_json_rpc_error,
    build_mcp_route_key,
    build_mcp_routes_config,
    get_mcp_list_payment_requirements,
    get_mcp_route_key,
    is_mcp_list_method,
    parse_mcp_request,
)
from .telemetry import build_event_payload, log_event, report_error, send_event  # noqa: E402
from .handler import handle_payment_request  # noqa: E402
from .api import format_api_payment_error  # noqa: E402
from .web import format_web_payment_error  # noqa: E402
