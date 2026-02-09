import type { Request } from "express";
import type { RequestAdapter } from "@foldset/core";

export class ExpressAdapter implements RequestAdapter {
  constructor(private req: Request) {}

  getIpAddress(): string | null {
    const forwarded = this.req.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]!.trim();
    return this.req.ip ?? null;
  }

  getHeader(name: string): string | undefined {
    return this.req.get(name);
  }

  getMethod(): string {
    return this.req.method;
  }

  getPath(): string {
    return this.req.path;
  }

  getUrl(): string {
    return `${this.req.protocol}://${this.req.get("host")}${this.req.originalUrl}`;
  }

  getHost(): string {
    return this.req.hostname;
  }

  getAcceptHeader(): string {
    return this.req.get("Accept") ?? "";
  }

  getUserAgent(): string {
    return this.req.get("User-Agent") ?? "";
  }

  getQueryParams(): Record<string, string | string[]> {
    const result: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(this.req.query)) {
      if (typeof value === "string") {
        result[key] = value;
      } else if (Array.isArray(value)) {
        result[key] = value.filter((v): v is string => typeof v === "string");
      }
    }
    return result;
  }

  getQueryParam(name: string): string | string[] | undefined {
    return this.getQueryParams()[name];
  }

  async getBody(): Promise<unknown> {
    return this.req.body;
  }
}
