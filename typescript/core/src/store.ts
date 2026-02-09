import { Redis } from "@upstash/redis";

import { API_BASE_URL } from "./config";
import type { ConfigStore } from "./types";

export interface RedisCredentials {
  url: string;
  token: string;
  tenantId: string;
}

export async function fetchRedisCredentials(
  apiKey: string,
): Promise<RedisCredentials> {
  const response = await fetch(`${API_BASE_URL}/v1/config/redis`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Redis credentials: ${response.status} ${response.statusText}`,
    );
  }

  const { data } = (await response.json()) as { data: RedisCredentials };
  return data;
}

export function createRedisStore(credentials: RedisCredentials): ConfigStore {
  const redis = new Redis({
    url: credentials.url,
    token: credentials.token,
    automaticDeserialization: false,
  });
  const prefix = credentials.tenantId;

  return {
    async get(key) {
      return redis.get<string>(`${prefix}:${key}`);
    },
  };
}
