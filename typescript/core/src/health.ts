import packageJson from "../package.json" with { type: "json" };

export const HEALTH_PATH = "/.well-known/foldset";

export function buildHealthResponse(platform: string, sdkVersion: string): string {
  return JSON.stringify({
    status: "ok",
    core_version: packageJson.version,
    sdk_version: sdkVersion,
    platform,
    timestamp: new Date().toISOString(),
  });
}
