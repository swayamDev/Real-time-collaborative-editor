import { describe, expect, it } from "vitest";
import { clientAddress, clientIpOptions } from "./client-ip";

describe("clientIpOptions", () => {
  it("trusts no header by default", () => {
    expect(clientIpOptions({})).toEqual({ disableIpTracking: true });
    expect(clientIpOptions({ AUTH_CLIENT_IP_HEADER: "  " })).toEqual({ disableIpTracking: true });
  });

  it("trusts only the configured header, with optional proxies", () => {
    expect(clientIpOptions({ AUTH_CLIENT_IP_HEADER: "CF-Connecting-IP" })).toEqual({ ipAddressHeaders: ["cf-connecting-ip"] });
    expect(
      clientIpOptions({ AUTH_CLIENT_IP_HEADER: "x-forwarded-for", AUTH_TRUSTED_PROXIES: "10.0.0.0/8, 192.0.2.10" }),
    ).toEqual({ ipAddressHeaders: ["x-forwarded-for"], trustedProxies: ["10.0.0.0/8", "192.0.2.10"] });
  });

  it("refuses something that is not a header name", () => {
    expect(() => clientIpOptions({ AUTH_CLIENT_IP_HEADER: "x-forwarded-for: 1.2.3.4" })).toThrow();
  });
});

describe("clientAddress", () => {
  const headers = (value: string) => new Headers({ "x-forwarded-for": value });

  it("is null when no header is trusted, whatever the request claims", () => {
    expect(clientAddress(headers("1.2.3.4"), {})).toBeNull();
  });

  it("reads the trusted header", () => {
    expect(clientAddress(headers("203.0.113.7"), { AUTH_CLIENT_IP_HEADER: "x-forwarded-for" })).toBe("203.0.113.7");
    expect(clientAddress(new Headers(), { AUTH_CLIENT_IP_HEADER: "x-forwarded-for" })).toBeNull();
  });

  it("skips listed proxies from the right", () => {
    const env = { AUTH_CLIENT_IP_HEADER: "x-forwarded-for", AUTH_TRUSTED_PROXIES: "10.0.0.1" };
    expect(clientAddress(headers("1.2.3.4, 203.0.113.7, 10.0.0.1"), env)).toBe("203.0.113.7");
  });
});
