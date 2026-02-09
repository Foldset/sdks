from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from x402.http import RouteConfig

from .config import no_payment_required
from .handler import handle_payment_request
from .routes import RoutesConfig, build_route_entry, price_to_amount
from .telemetry import log_event
from .types import (
    McpRestriction,
    PaymentMethod,
    ProcessRequestResult,
    RequestAdapter,
    RequestMetadata,
    Restriction,
)

if TYPE_CHECKING:
    from . import WorkerCore


@dataclass
class JsonRpcRequest:
    jsonrpc: str
    method: str
    id: str | int | None = None
    params: dict[str, Any] | None = None


MCP_LIST_CALL_METHODS: dict[str, str] = {
    "tools/list": "tools/call",
    "resources/list": "resources/read",
    "prompts/list": "prompts/get",
}


def parse_mcp_request(body: Any) -> JsonRpcRequest | None:
    if not isinstance(body, dict) or "jsonrpc" not in body or "method" not in body:
        return None
    return JsonRpcRequest(
        jsonrpc=body["jsonrpc"],
        method=body["method"],
        id=body.get("id"),
        params=body.get("params"),
    )


def build_mcp_route_key(endpoint_path: str, restriction: McpRestriction) -> str:
    return f"{endpoint_path}/{restriction.method}:{restriction.name}"


def build_mcp_routes_config(
    restrictions: list[Restriction],
    payment_methods: list[PaymentMethod],
    mcp_endpoint: str,
    terms_of_service_url: str | None = None,
) -> RoutesConfig:
    routes_config: RoutesConfig = {}

    for r in restrictions:
        if not isinstance(r, McpRestriction):
            continue
        key = build_mcp_route_key(mcp_endpoint, r)
        routes_config[key] = build_route_entry(r, payment_methods, terms_of_service_url)

    return routes_config


def get_mcp_route_key(
    endpoint_path: str,
    method: str,
    params: dict[str, Any] | None = None,
) -> str | None:
    identifier = (params or {}).get("name") or (params or {}).get("uri")
    if not isinstance(identifier, str):
        return None
    return f"{endpoint_path}/{method}:{identifier}"


def is_mcp_list_method(method: str) -> bool:
    return method in MCP_LIST_CALL_METHODS


@dataclass
class McpPaymentRequirement:
    name: str
    method: str
    description: str
    price: float
    scheme: str
    accepts: list[dict[str, Any]]


@dataclass
class JsonRpcError:
    jsonrpc: str
    id: str | int | None
    error: dict[str, Any]


def build_json_rpc_error(
    rpc_id: str | int | None,
    code: int,
    message: str,
    data: Any = None,
) -> dict[str, Any]:
    error: dict[str, Any] = {"jsonrpc": "2.0", "id": rpc_id, "error": {"code": code, "message": message}}
    if data is not None:
        error["error"]["data"] = data
    return error


def get_mcp_list_payment_requirements(
    list_method: str,
    restrictions: list[Restriction],
    payment_methods: list[PaymentMethod],
) -> list[McpPaymentRequirement]:
    call_method = MCP_LIST_CALL_METHODS.get(list_method)
    if not call_method:
        return []

    relevant = [
        r
        for r in restrictions
        if isinstance(r, McpRestriction) and r.method == call_method and r.price > 0
    ]
    if not relevant:
        return []

    return [
        McpPaymentRequirement(
            name=r.name,
            method=r.method,
            description=r.description,
            price=r.price,
            scheme=r.scheme,
            accepts=[
                {
                    "network": pm.caip2_id,
                    "chainDisplayName": pm.chain_display_name,
                    "asset": pm.contract_address,
                    "assetDisplayName": pm.asset_display_name,
                    "amount": price_to_amount(r.price, pm.decimals),
                    "payTo": pm.circle_wallet_address,
                }
                for pm in payment_methods
            ],
        )
        for r in relevant
    ]


async def _format_mcp_payment_error(
    core: WorkerCore,
    result: ProcessRequestResult,
    rpc_id: str | int | None,
) -> None:
    payment_methods, host_config = await asyncio.gather(
        core.payment_methods.get(),
        core.host_config.get(),
    )

    data: dict[str, Any] = {
        "version": result.metadata.version,
        "request_id": result.metadata.request_id,
        "timestamp": result.metadata.timestamp,
        "description": result.restriction.description if result.restriction else "",
        "price": result.restriction.price if result.restriction else 0,
    }
    if host_config and host_config.terms_of_service_url:
        data["terms_of_service_url"] = host_config.terms_of_service_url
    data["payment_methods"] = [
        {
            "network": pm.caip2_id,
            "asset": pm.contract_address,
            "decimals": pm.decimals,
            "pay_to": pm.circle_wallet_address,
            "chain": pm.chain_display_name,
            "asset_name": pm.asset_display_name,
        }
        for pm in payment_methods
    ]

    result.response.body = json.dumps(
        build_json_rpc_error(rpc_id, 402, "Payment required", data)
    )
    result.response.headers["Content-Type"] = "application/json"


async def handle_mcp_request(
    core: WorkerCore,
    adapter: RequestAdapter,
    mcp_endpoint: str,
    metadata: RequestMetadata,
) -> ProcessRequestResult:
    if adapter.get_method() != "POST":
        return no_payment_required(metadata)

    body = await adapter.get_body()
    rpc = parse_mcp_request(body)
    if not rpc:
        return no_payment_required(metadata)

    # List methods: pass through with payment requirements header
    if is_mcp_list_method(rpc.method):
        restrictions, payment_methods, host_config = await asyncio.gather(
            core.restrictions.get(),
            core.payment_methods.get(),
            core.host_config.get(),
        )
        requirements = get_mcp_list_payment_requirements(
            rpc.method, restrictions, payment_methods
        )
        headers: dict[str, str] = {}
        if requirements:
            payload: dict[str, Any] = {
                "requirements": [
                    {
                        "name": r.name,
                        "method": r.method,
                        "description": r.description,
                        "price": r.price,
                        "scheme": r.scheme,
                        "accepts": r.accepts,
                    }
                    for r in requirements
                ]
            }
            if host_config and host_config.terms_of_service_url:
                payload["terms_of_service_url"] = host_config.terms_of_service_url
            headers["Payment-Required"] = json.dumps(payload)
        await log_event(core, adapter, 200, metadata.request_id)
        return ProcessRequestResult(
            type="no-payment-required", headers=headers, metadata=metadata
        )

    route_key = get_mcp_route_key(mcp_endpoint, rpc.method, rpc.params)
    if not route_key:
        return no_payment_required(metadata)

    result = await handle_payment_request(core, adapter, metadata, route_key)

    if result.type == "payment-error":
        await _format_mcp_payment_error(core, result, rpc.id)

    return result
