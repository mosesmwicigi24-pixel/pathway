// Church service scheduling. The check-in window is the security boundary —
// a service's scan token is a stable HMAC, so a photograph of the projected
// code keeps working until the window closes. These pin the arithmetic.
import { describe, it, expect } from "vitest";
import {
  checkinWindow,
  hhmm,
  isoDate,
  phaseRank,
  servicePhase,
  type ServiceScheduleFields,
} from "../src/util/serviceSchedule";

const START = "2026-03-01T09:00:00.000Z";
const at = (iso: string): number => new Date(iso).getTime();

function service(over: Partial<ServiceScheduleFields> = {}): ServiceScheduleFields {
  return {
    qr_enabled: true,
    checkin_open: false,
    checkin_opens_at: "2026-03-01T08:15:00.000Z",
    starts_at: START,
    ...over,
  };
}

describe("checkinWindow", () => {
  it("brackets the start time by the given minutes", () => {
    const w = checkinWindow(new Date(START), 45, 120);
    expect(w.opens_at).toBe("2026-03-01T08:15:00.000Z");
    expect(w.closes_at).toBe("2026-03-01T11:00:00.000Z");
  });

  it("treats zero as 'opens exactly at the start'", () => {
    const w = checkinWindow(new Date(START), 0, 0);
    expect(w.opens_at).toBe(START);
    expect(w.closes_at).toBe(START);
  });

  // A negative value would invert the window — opening AFTER it closes — which
  // silently removes the only control on a replayed photo of the code.
  it("clamps negatives to zero rather than inverting the window", () => {
    const w = checkinWindow(new Date(START), -60, -60);
    expect(w.opens_at).toBe(START);
    expect(w.closes_at).toBe(START);
    expect(new Date(w.opens_at).getTime()).toBeLessThanOrEqual(new Date(w.closes_at).getTime());
  });

  it("caps a wild value at a day either side", () => {
    const w = checkinWindow(new Date(START), 99_999, 99_999);
    expect(w.opens_at).toBe("2026-02-28T09:00:00.000Z");
    expect(w.closes_at).toBe("2026-03-02T09:00:00.000Z");
  });

  it("survives NaN without producing an invalid date", () => {
    const w = checkinWindow(new Date(START), Number.NaN, Number.NaN);
    expect(w.opens_at).toBe(START);
    expect(w.closes_at).toBe(START);
  });

  it("never opens after it closes, for any input", () => {
    for (const [before, after] of [[45, 120], [0, 0], [-5, 900], [1440, 1440], [10, -10]]) {
      const w = checkinWindow(new Date(START), before!, after!);
      expect(new Date(w.opens_at).getTime()).toBeLessThanOrEqual(new Date(w.closes_at).getTime());
    }
  });
});

describe("servicePhase", () => {
  it("defers to the server on whether a scan is accepted right now", () => {
    // Even with a window that looks shut, the server's verdict wins — the
    // client never decides whether a check-in would succeed.
    expect(servicePhase(service({ checkin_open: true }), at("2026-03-01T23:00:00.000Z"))).toBe("open");
  });

  it("is upcoming before the window opens and closed after", () => {
    expect(servicePhase(service(), at("2026-03-01T07:00:00.000Z"))).toBe("upcoming");
    expect(servicePhase(service(), at("2026-03-01T12:00:00.000Z"))).toBe("closed");
  });

  it("falls back to the start time when no window is set", () => {
    const s = service({ checkin_opens_at: null });
    expect(servicePhase(s, at("2026-03-01T08:00:00.000Z"))).toBe("upcoming");
    expect(servicePhase(s, at("2026-03-01T10:00:00.000Z"))).toBe("closed");
  });

  it("reports a disabled QR ahead of anything else", () => {
    expect(servicePhase(service({ qr_enabled: false, checkin_open: true }), at(START))).toBe("disabled");
  });

  // An unparseable timestamp must not read as "upcoming forever" and pin a
  // broken row to the top of the list.
  it("treats an unparseable timestamp as past, not perpetually upcoming", () => {
    expect(servicePhase(service({ checkin_opens_at: "not-a-date" }), at(START))).toBe("closed");
  });

  it("ranks whatever is scannable now to the top", () => {
    expect(phaseRank("open")).toBeLessThan(phaseRank("upcoming"));
    expect(phaseRank("upcoming")).toBeLessThan(phaseRank("closed"));
    expect(phaseRank("closed")).toBeLessThan(phaseRank("disabled"));
  });
});

describe("formatting", () => {
  it("renders local wall-clock time, zero-padded", () => {
    // Built from local parts so the assertion holds in any TZ the suite runs in.
    const d = new Date(2026, 2, 1, 9, 5);
    expect(hhmm(d.toISOString())).toBe("09:05");
  });

  it("passes an unparseable value through untouched", () => {
    expect(hhmm("not-a-date")).toBe("not-a-date");
  });

  it("formats a local date without shifting the day", () => {
    // toISOString() would roll this back a day west of UTC; isoDate must not.
    expect(isoDate(new Date(2026, 0, 1, 0, 30))).toBe("2026-01-01");
    expect(isoDate(new Date(2026, 11, 31, 23, 30))).toBe("2026-12-31");
  });
});
