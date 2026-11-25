import { describe, expect, it } from "vitest";
import { isRejectedRefresh } from "../src/auth/refreshFailure";

describe("refresh failure classification", () => {
  it("ends the session only on an explicit unauthorized response", () => {
    expect(isRejectedRefresh({ response: { status: 401 } })).toBe(true);
    expect(isRejectedRefresh({ response: { status: 500 } })).toBe(false);
    expect(isRejectedRefresh(new Error("network timeout"))).toBe(false);
    expect(isRejectedRefresh(null)).toBe(false);
  });
});
