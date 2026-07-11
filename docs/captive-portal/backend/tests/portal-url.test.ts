import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { portalHomePath, portalPublicBase, portalUrl } from "../src/lib/portal-url";

function makeReq(headers: Record<string, string> = {}) {
  return {
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
    nextUrl: { protocol: "http:" },
  } as any;
}

describe("portal URL helpers", () => {
  it("prefers the configured public base over localhost-derived headers", () => {
    process.env.PORTAL_PUBLIC_URL = "https://wifi-controller.example";
    const req = makeReq({
      host: "localhost:3000",
      "x-forwarded-host": "localhost:3000",
      "x-forwarded-proto": "http",
    });

    assert.equal(portalPublicBase(req), "https://wifi-controller.example");
    assert.equal(portalUrl("/api/denied", req), "https://wifi-controller.example/api/denied");
  });

  it("falls back to the controller IP when no public URL is configured", () => {
    delete process.env.PORTAL_PUBLIC_URL;
    const req = makeReq({
      host: "localhost:3000",
      "x-forwarded-host": "localhost:3000",
      "x-forwarded-proto": "http",
    });

    assert.equal(portalPublicBase(req), "http://192.168.10.2");
    assert.equal(portalUrl("/api/denied", req), "http://192.168.10.2/api/denied");
  });

  it("routes the root path to the captive portal while preserving query params", () => {
    assert.equal(portalHomePath({ mac: "AA:BB", target: "http://example.com" }), "/api/captive?mac=AA%3ABB&target=http%3A%2F%2Fexample.com");
  });
});
