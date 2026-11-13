import { describe, expect, it } from "vitest";
import { KEEPALIVE_BODY_LIMIT, chooseTransport } from "./save-transport";

describe("chooseTransport", () => {
  it("uses a normal fetch while the page is open", () => {
    expect(chooseTransport(10, false)).toBe("normal");
  });

  it("uses keepalive on unload when the body fits", () => {
    expect(chooseTransport(10, true)).toBe("keepalive");
    expect(chooseTransport(KEEPALIVE_BODY_LIMIT, true)).toBe("keepalive");
  });

  it("falls back to a normal fetch on unload when the body exceeds 64 KiB", () => {
    expect(chooseTransport(KEEPALIVE_BODY_LIMIT + 1, true)).toBe("normal");
  });
});
