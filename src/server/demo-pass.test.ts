import { describe, expect, it } from "vitest";
import { decodeDemoPass, demoSeatUserId, encodeDemoPass, passAllowsSeat } from "./demo-pass";

const SECRET = "not-a-real-secret-for-demo-pass-tests";
const pass = { documentId: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b", expiresAt: Date.now() + 60_000, seats: "ab" as const };

describe("demo passes", () => {
  it("round trips", () => {
    expect(decodeDemoPass(encodeDemoPass(pass, SECRET), SECRET)).toEqual(pass);
  });

  it("refuses an expired pass", () => {
    const value = encodeDemoPass(pass, SECRET);
    expect(decodeDemoPass(value, SECRET, pass.expiresAt)).toBeNull();
  });

  it("refuses a pass signed with another secret", () => {
    expect(decodeDemoPass(encodeDemoPass(pass, SECRET), "another-secret-another-secret-another")).toBeNull();
  });

  it("refuses any change: another document, a later expiry, more seats", () => {
    const [, expires, , signature] = encodeDemoPass({ ...pass, seats: "b" }, SECRET).split(".");
    const other = "00000000-0000-4000-8000-000000000000";
    expect(decodeDemoPass(`${other}.${expires}.b.${signature}`, SECRET)).toBeNull();
    expect(decodeDemoPass(`${pass.documentId}.${Number(expires) + 1}.b.${signature}`, SECRET)).toBeNull();
    expect(decodeDemoPass(`${pass.documentId}.${expires}.ab.${signature}`, SECRET)).toBeNull();
  });

  it("refuses malformed values", () => {
    for (const value of [undefined, "", "a.b.c", "not-a-uuid.1.ab.sig", `${pass.documentId}.soon.ab.sig`, `${pass.documentId}.1.c.sig`]) {
      expect(decodeDemoPass(value, SECRET)).toBeNull();
    }
  });

  it("gives a join link only seat B", () => {
    const join = { ...pass, seats: "b" as const };
    expect(passAllowsSeat(join, "b")).toBe(true);
    expect(passAllowsSeat(join, "a")).toBe(false);
    expect(passAllowsSeat(pass, "a")).toBe(true);
    expect(passAllowsSeat(pass, "c")).toBe(false);
    expect(demoSeatUserId(pass.documentId, "b")).toBe(`demo:${pass.documentId}:b`);
  });
});
