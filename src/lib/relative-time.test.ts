import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatAbsoluteDate, formatRelativeTime } from "./relative-time";

// Pin the local time zone so calendar-day rules are deterministic.
const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "UTC";
});
afterAll(() => {
  process.env.TZ = originalTz;
});

const now = Date.parse("2026-11-13T15:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("formatRelativeTime", () => {
  it("shows Just now under a minute, including small clock skew", () => {
    expect(formatRelativeTime(ago(30_000), now)).toBe("Just now");
    expect(formatRelativeTime(ago(-5_000), now)).toBe("Just now");
  });

  it("shows minutes and hours on the same day", () => {
    expect(formatRelativeTime(ago(5 * 60_000), now)).toBe("5m");
    expect(formatRelativeTime(ago(3 * 3_600_000), now)).toBe("3h");
  });

  it("shows Yesterday for the previous calendar day", () => {
    expect(formatRelativeTime("2026-11-12T23:30:00Z", now)).toBe("Yesterday");
  });

  it("shows a short date this year and includes the year otherwise", () => {
    expect(formatRelativeTime("2026-11-09T10:00:00Z", now)).toBe("Nov 9");
    expect(formatRelativeTime("2025-11-09T10:00:00Z", now)).toBe("Nov 9, 2025");
  });
});

describe("formatAbsoluteDate", () => {
  it("formats in UTC regardless of local time zone", () => {
    expect(formatAbsoluteDate("2026-11-09T23:30:00Z")).toBe("Nov 9");
  });
});
