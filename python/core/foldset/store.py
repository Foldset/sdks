from __future__ import annotations

import httpx
from upstash_redis import AsyncRedis

from .config import API_BASE_URL
from .types import ConfigStore, RedisCredentials


async def fetch_redis_credentials(api_key: str) -> RedisCredentials:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{API_BASE_URL}/v1/config/redis",
            headers={"Authorization": f"Bearer {api_key}"},
        )

    if response.status_code != 200:
        raise RuntimeError(
            f"Failed to fetch Redis credentials: {response.status_code} {response.text}"
        )

    data = response.json()["data"]
    return RedisCredentials(
        url=data["url"],
        token=data["token"],
        tenant_id=data["tenantId"],
    )


class RedisConfigStore:
    def __init__(self, credentials: RedisCredentials) -> None:
        self._redis = AsyncRedis(url=credentials.url, token=credentials.token)
        self._prefix = credentials.tenant_id

    async def get(self, key: str) -> str | None:
        result = await self._redis.get(f"{self._prefix}:{key}")
        if result is None:
            return None
        if isinstance(result, bytes):
            return result.decode()
        return str(result)


def create_redis_store(credentials: RedisCredentials) -> ConfigStore:
    return RedisConfigStore(credentials)
