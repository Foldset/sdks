import type { Context } from "hono";
import type { RequestAdapter } from "@foldset/core";

export class HonoAdapter implements RequestAdapter {
  private bodyPromise: Promise<unknown> | null = null;

  constructor(private c: Context) {}

  getIpAddress(): string | null {
    const forwarded = this.getHeader("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]!.trim();
    return null;
  }

  getHeader(name: string): string | undefined {
    return this.c.req.header(name);
  }

  getMethod(): string {
    return this.c.req.method;
  }

  getPath(): string {
    return this.c.req.path;
  }

  getUrl(): string {
    return this.c.req.url;
  }

  getHost(): string {
    return new URL(this.c.req.url).hostname;
  }

  getAcceptHeader(): string {
    return this.getHeader("Accept") ?? "";
  }

  getUserAgent(): string {
    return this.getHeader("User-Agent") ?? "";
  }

  getQueryParams(): Record<string, string | string[]> {
    return this.c.req.query();
  }

  getQueryParam(name: string): string | string[] | undefined {
    return this.c.req.query(name);
  }

  getBody(): Promise<unknown> {
    this.bodyPromise ??= this.c.req.json().catch(() => undefined);
    return this.bodyPromise;
  }
}
