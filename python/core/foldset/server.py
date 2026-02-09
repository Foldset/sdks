from __future__ import annotations

import asyncio
import re
import time

from x402 import x402ResourceServer
from x402.http import (
    HTTPProcessResult,
    HTTPRequestContext,
    HTTPResponseInstructions,
    PaywallConfig,
    x402HTTPResourceServer,
)
from x402.mechanisms.evm.exact.register import register_exact_evm_server
from x402.mechanisms.svm.exact.register import register_exact_svm_server

from .config import (
    CACHE_TTL_MS,
    FacilitatorManager,
    HostConfigManager,
    PaymentMethodsManager,
    RestrictionsManager,
)
from .mcp import build_mcp_routes_config
from .routes import RoutesConfig, build_routes_config
from .types import ConfigStore, HttpServerResult, Restriction


class FoldsetHTTPResourceServer(x402HTTPResourceServer):
    """x402HTTPResourceServer with Foldset-specific overrides.

    - Treats route patterns as raw regex (restrictions store regex paths)
    - Returns empty body on payment-required (body set later by api/web/mcp)
    - Attaches matched restriction to payment-error results
    """

    @staticmethod
    def _parse_route_pattern(pattern: str) -> tuple[str, re.Pattern[str]]:
        parts = pattern.split(None, 1)
        if len(parts) == 2:
            verb = parts[0].upper()
            path = parts[1]
        else:
            verb = "*"
            path = pattern
        return verb, re.compile(path, re.IGNORECASE)

    def _create_http_response(
        self,
        payment_required,
        is_web_browser: bool,
        paywall_config=None,
        custom_html=None,
        unpaid_response=None,
    ) -> HTTPResponseInstructions:
        """Return payment-required headers only, empty body.

        Body is set later by api.py, web.py, or mcp.py based on restriction type.
        """
        from x402.http.utils import encode_payment_required_header
        from x402.http.constants import PAYMENT_REQUIRED_HEADER

        return HTTPResponseInstructions(
            status=402,
            headers={
                PAYMENT_REQUIRED_HEADER: encode_payment_required_header(payment_required),
            },
            body="",
        )

    async def process_http_request_with_restriction(
        self,
        context: HTTPRequestContext,
        paywall_config: PaywallConfig | None = None,
    ) -> HttpServerResult:
        result = await self.process_http_request(context, paywall_config)

        restriction = None
        if result.type == "payment-error":
            route_config = self._get_route_config(context.path, context.method)
            if route_config:
                restriction = getattr(route_config, "restriction", None)

        from .config import build_request_metadata

        metadata = build_request_metadata()

        return HttpServerResult(
            type=result.type,
            metadata=metadata,
            restriction=restriction,
            response=result.response,
            payment_payload=result.payment_payload,
            payment_requirements=result.payment_requirements,
        )


class HttpServerManager:
    def __init__(self, store: ConfigStore) -> None:
        self._cached: FoldsetHTTPResourceServer | None = None
        self._cache_timestamp: float = 0
        self._host_config = HostConfigManager(store)
        self._restrictions = RestrictionsManager(store)
        self._payment_methods = PaymentMethodsManager(store)
        self._facilitator = FacilitatorManager(store)

    async def get(self) -> FoldsetHTTPResourceServer | None:
        if self._cached and (time.time() * 1000 - self._cache_timestamp) < CACHE_TTL_MS:
            return self._cached

        host_config, restrictions, payment_methods, facilitator = await asyncio.gather(
            self._host_config.get(),
            self._restrictions.get(),
            self._payment_methods.get(),
            self._facilitator.get(),
        )

        if not host_config or not facilitator:
            return None

        server = x402ResourceServer(facilitator)
        register_exact_evm_server(server)
        register_exact_svm_server(server)

        content_routes = build_routes_config(
            restrictions, payment_methods, host_config.terms_of_service_url
        )
        mcp_routes = (
            build_mcp_routes_config(
                restrictions,
                payment_methods,
                host_config.mcp_endpoint,
                host_config.terms_of_service_url,
            )
            if host_config.mcp_endpoint
            else {}
        )
        routes_config: RoutesConfig = {**content_routes, **mcp_routes}

        http_server = FoldsetHTTPResourceServer(server, routes_config)
        http_server.initialize()

        self._cached = http_server
        self._cache_timestamp = time.time() * 1000

        return self._cached
