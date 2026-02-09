import type { RequestAdapter } from "@foldset/core";
import type { NextRequest } from "next/server";

export class NextjsAdapter implements RequestAdapter {
  constructor(private readonly request: NextRequest) {}

  getIpAddress(): string | null {
    return this.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  }

  getHeader(name: string): string | undefined {
    return this.request.headers.get(name) ?? undefined;
  }

  getMethod(): string {
    return this.request.method;
  }

  getPath(): string {
    return this.request.nextUrl.pathname;
  }

  getUrl(): string {
    return this.request.url;
  }

  getHost(): string {
    return this.request.nextUrl.hostname;
  }

  getAcceptHeader(): string {
    return this.request.headers.get("Accept") ?? "";
  }

  getUserAgent(): string {
    return this.request.headers.get("User-Agent") ?? "";
  }

  getQueryParams(): Record<string, string | string[]> {
    const params = this.request.nextUrl.searchParams;
    const result: Record<string, string | string[]> = {};

    for (const key of new Set(params.keys())) {
      const values = params.getAll(key);
      result[key] = values.length === 1 ? values[0] : values;
    }

    return result;
  }

  getQueryParam(name: string): string | string[] | undefined {
    const params = this.request.nextUrl.searchParams;
    if (!params.has(name)) return undefined;

    const values = params.getAll(name);
    return values.length === 1 ? values[0] : values;
  }

  getBody(): Promise<unknown> {
    return this.request.json().catch(() => undefined);
  }
}
