import { describe, expect, it } from "vitest";
import { schemaFromSubprotocols, schemaSubprotocol } from "./schema";

describe("schema subprotocol", () => {
  it("round-trips a version", () => {
    expect(schemaFromSubprotocols(`brahma.v1, ${schemaSubprotocol(3)}, auth.x.y.z`)).toBe(3);
  });

  it.each([null, "", "brahma.v1, auth.x", "schema.", "schema.0", "schema.-1", "schema.01", "schema.1.5", "schema.abc", "schema.99999999"])(
    "reads %j as 0",
    (header) => expect(schemaFromSubprotocols(header)).toBe(0),
  );
});
