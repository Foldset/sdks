from __future__ import annotations

from typing import TYPE_CHECKING, Any

from x402.http import HTTPRequestContext, ProcessSettleResult

from .api import format_api_payment_error
from .config import no_payment_required
from .telemetry import log_event
from .types import ProcessRequestResult, RequestAdapter, RequestMetadata
from .web import format_web_payment_error

if TYPE_CHECKING:
    from . import WorkerCore


def _settlement_failure(reason: str, network: str) -> ProcessSettleResult:
    return ProcessSettleResult(success=False, error_reason=reason)


async def handle_payment_request(
    core: WorkerCore,
    adapter: RequestAdapter,
    metadata: RequestMetadata,
    path_override: str | None = None,
) -> ProcessRequestResult:
    http_server = await core.http_server.get()
    if not http_server:
        return no_payment_required(metadata)

    path = path_override or adapter.get_path()

    context = HTTPRequestContext(
        adapter=adapter,
        path=path,
        method=adapter.get_method(),
        payment_header=(
            adapter.get_header("PAYMENT-SIGNATURE")
            or adapter.get_header("X-PAYMENT")
        ),
    )

    if not http_server.requires_payment(context):
        return no_payment_required(metadata)

    result = await http_server.process_http_request_with_restriction(context)
    result.metadata = metadata

    if result.type == "payment-error":
        if result.restriction and result.restriction.price == 0:
            await log_event(core, adapter, 200, metadata.request_id)
            return no_payment_required(metadata)
        await log_event(core, adapter, result.response.status if result.response else 402, metadata.request_id)

    return result


async def handle_request(
    core: WorkerCore,
    adapter: RequestAdapter,
    metadata: RequestMetadata,
) -> ProcessRequestResult:
    user_agent = adapter.get_user_agent()
    bot = await core.bots.match_bot(user_agent) if user_agent else None
    host_config = await core.host_config.get()

    should_check = bot or (host_config and host_config.api_protection_mode == "all")
    if not should_check:
        return no_payment_required(metadata)

    result = await handle_payment_request(core, adapter, metadata)

    if result.type != "payment-error":
        return result

    # Web restrictions are always bot-only
    if result.restriction and result.restriction.type == "web" and not bot:
        return no_payment_required(metadata)

    payment_methods = await core.payment_methods.get()

    if payment_methods and result.restriction:
        if result.restriction.type == "api":
            format_api_payment_error(
                result, result.restriction, payment_methods, host_config.terms_of_service_url if host_config else None
            )
        elif result.restriction.type == "web":
            format_web_payment_error(
                result, result.restriction, payment_methods, adapter, host_config.terms_of_service_url if host_config else None
            )

    if bot and bot.force_200 and result.response:
        result.response.status = 200

    return result


async def handle_settlement(
    core: WorkerCore,
    adapter: RequestAdapter,
    payment_payload: Any,
    payment_requirements: Any,
    upstream_status_code: int,
    request_id: str,
) -> ProcessSettleResult:
    http_server = await core.http_server.get()
    if not http_server:
        return _settlement_failure("Server not initialized", "")

    if upstream_status_code >= 400:
        await log_event(core, adapter, upstream_status_code, request_id)
        return _settlement_failure("Upstream error", "")

    result = await http_server.process_settlement(
        payment_payload,
        payment_requirements,
    )

    if result.success:
        payment_response = result.headers.get("PAYMENT-RESPONSE")
        await log_event(core, adapter, upstream_status_code, request_id, payment_response)
    else:
        await log_event(core, adapter, 402, request_id)

    return result
