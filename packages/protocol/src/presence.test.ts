import { describe, expect, it } from "vitest";
import {
  COLLAB_COLORS,
  DEFAULT_NAME,
  NAME_MAX_LENGTH,
  assignColors,
  initials,
  parsePeerUser,
  preferredColor,
  sanitizeImage,
  sanitizeName,
} from "./presence";

describe("sanitizeName", () => {
  it("trims and collapses whitespace", () => {
    expect(sanitizeName("  Ada   Lovelace \t")).toBe("Ada Lovelace");
  });

  it("strips control characters", () => {
    expect(sanitizeName("Ada\u0000\u0007\u001b[31mRed\u007f")).toBe("Ada [31mRed");
    expect(sanitizeName("Line\nbreak")).toBe("Line break");
  });

  it("strips bidirectional overrides that could reorder a name", () => {
    expect(sanitizeName("abc‮dcba")).toBe("abc dcba");
    expect(sanitizeName("⁦x⁩")).toBe("x");
  });

  it("caps at 40 characters without splitting emoji", () => {
    expect([...sanitizeName("a".repeat(100))]).toHaveLength(NAME_MAX_LENGTH);
    const emoji = sanitizeName("\u{1F600}".repeat(50));
    expect([...emoji]).toHaveLength(NAME_MAX_LENGTH);
    expect(emoji).toBe("\u{1F600}".repeat(NAME_MAX_LENGTH));
  });

  it("falls back to Guest for empty or non-string input", () => {
    expect(sanitizeName("   ")).toBe(DEFAULT_NAME);
    expect(sanitizeName("\u0000\u0001")).toBe(DEFAULT_NAME);
    expect(sanitizeName(42)).toBe(DEFAULT_NAME);
    expect(sanitizeName(undefined)).toBe(DEFAULT_NAME);
  });

  it("leaves markup as plain text for the renderer to escape", () => {
    expect(sanitizeName("<img src=x onerror=alert(1)>")).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("parsePeerUser", () => {
  it("accepts a well-formed state", () => {
    expect(
      parsePeerUser({ user: { id: "u_1", name: "Ada", color: "lac", image: "https://img.example/a.png", joinedAt: 5 } }, 7),
    ).toEqual({ name: "Ada", color: "lac", userId: "u_1", image: "https://img.example/a.png", joinedAt: 5 });
  });

  it("accepts only the six color tokens and falls back otherwise", () => {
    for (const color of ["#ff0000", "red", "var(--x)", "indigo; background:url(x)", 3, null]) {
      const user = parsePeerUser({ user: { name: "A", color, id: "g-1", joinedAt: 1 } }, 1);
      expect(user?.color).toBe(preferredColor("g-1"));
    }
  });

  it("sanitizes the name and invalid fields", () => {
    const user = parsePeerUser({ user: { name: "‮evil", id: "../../x", image: "javascript:alert(1)", joinedAt: -1 } }, 9);
    expect(user).toEqual({
      name: "evil",
      color: preferredColor("client-9"),
      userId: "client-9",
      image: null,
      joinedAt: Number.MAX_SAFE_INTEGER,
    });
  });

  it("returns null when there is no user object", () => {
    expect(parsePeerUser(null, 1)).toBeNull();
    expect(parsePeerUser({ cursor: {} }, 1)).toBeNull();
    expect(parsePeerUser({ user: "Ada" }, 1)).toBeNull();
  });
});

/** Find `count` user ids whose preferred color is `color`. */
function userIdsPreferring(color: (typeof COLLAB_COLORS)[number], count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; ids.length < count; i++) {
    if (preferredColor(`guest-${i}`) === color) ids.push(`guest-${i}`);
  }
  return ids;
}

describe("assignColors", () => {
  it("gives each client its preferred color when free", () => {
    const [a] = userIdsPreferring("leaf", 1);
    const [b] = userIdsPreferring("lac", 1);
    const colors = assignColors([
      { clientId: 1, userId: a, joinedAt: 10 },
      { clientId: 2, userId: b, joinedAt: 20 },
    ]);
    expect(colors.get(1)).toBe("leaf");
    expect(colors.get(2)).toBe("lac");
  });

  it("lets the earlier joiner keep a contested color", () => {
    const [a, b] = userIdsPreferring("madder", 2);
    const colors = assignColors([
      { clientId: 99, userId: b, joinedAt: 20 },
      { clientId: 1, userId: a, joinedAt: 10 },
    ]);
    expect(colors.get(1)).toBe("madder");
    expect(colors.get(99)).toBe("turmeric");
  });

  it("breaks a tie on joinedAt by client id, and every client agrees", () => {
    const [a, b] = userIdsPreferring("kattha", 2);
    const sameTime = 1_700_000_000_000;
    const first = { clientId: 1001, userId: a, joinedAt: sameTime };
    const second = { clientId: 2002, userId: b, joinedAt: sameTime };

    // Each client sees peers in its own order; the result must not depend on it.
    const seenByA = assignColors([first, second]);
    const seenByB = assignColors([second, first]);
    expect(seenByA).toEqual(seenByB);
    expect(seenByA.get(1001)).toBe("kattha");
    // Next free color, wrapping around the palette.
    expect(seenByA.get(2002)).toBe("indigo");
  });

  it("uses all six colors before repeating", () => {
    const ids = userIdsPreferring("indigo", 7);
    const colors = assignColors(ids.map((userId, i) => ({ clientId: i + 1, userId, joinedAt: i })));
    expect(new Set([...colors.values()].slice(0, 6)).size).toBe(6);
    expect(colors.get(7)).toBe("indigo");
  });

  it("gives all of one person's tabs the same color, placed by their first tab", () => {
    const [a, b] = userIdsPreferring("leaf", 2);
    const colors = assignColors([
      { clientId: 1, userId: a, joinedAt: 10 },
      { clientId: 2, userId: b, joinedAt: 20 },
      { clientId: 3, userId: a, joinedAt: 30 },
    ]);
    expect(colors.get(1)).toBe("leaf");
    expect(colors.get(3)).toBe("leaf");
    expect(colors.get(2)).toBe("lac");
  });
});

describe("sanitizeImage", () => {
  it("keeps https URLs only", () => {
    expect(sanitizeImage("https://lh3.example/photo.jpg")).toBe("https://lh3.example/photo.jpg");
    for (const bad of ["http://x.example/a.png", "javascript:alert(1)", "data:image/png;base64,AA", "/relative", 4, null]) {
      expect(sanitizeImage(bad)).toBeNull();
    }
  });
});

describe("initials", () => {
  it("takes the first letter of the first two words", () => {
    expect(initials("ada lovelace byron")).toBe("AL");
    expect(initials("Grace")).toBe("G");
    expect(initials("")).toBe("G");
  });
});
