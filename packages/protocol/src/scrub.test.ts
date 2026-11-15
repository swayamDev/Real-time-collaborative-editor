import { describe, expect, it } from "vitest";
import { scrubEvent, scrubText } from "./scrub";

describe("scrubText", () => {
  it("replaces emails, tokens and share-link tokens", () => {
    const jwt = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1In0.c2lnbmF0dXJl";
    expect(scrubText(`Invite to Ada.Lovelace+x@Example.co.uk failed with ${jwt}`)).toBe(
      "Invite to [email] failed with [token]",
    );
    expect(scrubText("/s/0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d/AbC_dEf-123")).toBe(
      "/s/0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d/[link-token]",
    );
  });
});

describe("scrubEvent", () => {
  it("removes the user, request details and console breadcrumbs, and scrubs what remains", () => {
    const event = scrubEvent({
      user: { id: "u1", email: "ada@example.com", ip_address: "203.0.113.7" },
      extra: { args: ["ada@example.com"] },
      message: "Rename failed for ada@example.com",
      request: {
        url: "https://editor.swayam.space/s/0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d/secret?next=/d/x#h",
        data: '["doc","My private title"]',
        cookies: { "better-auth.session_token": "x" },
        headers: { cookie: "x", authorization: "Bearer y" },
        query_string: "email=ada@example.com",
      },
      exception: { values: [{ value: "Resend refused ada@example.com" }] },
      breadcrumbs: [
        { category: "console", message: "typed: my private text" },
        { category: "fetch", data: { url: "/api/documents/x/sync-token?a=1", body: "{}" } },
        { category: "navigation", data: { from: "/d/a", to: "/s/0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d/tok" } },
      ],
    });
    expect(event.user).toBeUndefined();
    expect(event.extra).toBeUndefined();
    expect(event.message).toBe("Rename failed for [email]");
    expect(event.request).toEqual({ url: "https://editor.swayam.space/s/0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d/[link-token]" });
    expect(event.exception?.values?.[0].value).toBe("Resend refused [email]");
    expect(event.breadcrumbs).toEqual([
      { category: "fetch", message: undefined, data: { url: "/api/documents/x/sync-token" } },
      { category: "navigation", message: undefined, data: { from: "/d/a", to: "/s/0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d/[link-token]" } },
    ]);
    expect(JSON.stringify(event)).not.toMatch(/ada@|private|secret|Bearer|session_token/);
  });
});
