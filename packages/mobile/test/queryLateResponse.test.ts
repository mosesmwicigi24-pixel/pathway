import { describe, expect, it, vi } from "vitest";

vi.mock("react", () => ({
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => void) => fn(),
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [value, () => undefined],
}));
vi.mock("react-native", () => ({ AppState: { addEventListener: vi.fn() } }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getAllKeys: async () => [],
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

import { beginQuerySession, clearQueryCache, setQueryData, useQuery } from "../src/api/query";

describe("late query response", () => {
  it("cannot repopulate a new member's cache after sign-out", async () => {
    let complete!: (value: { name: string }) => void;
    const response = new Promise<{ name: string }>((resolve) => { complete = resolve; });
    beginQuerySession();
    useQuery("me", () => response);
    await clearQueryCache();
    beginQuerySession();
    complete({ name: "first member" });
    await response;
    await Promise.resolve();
    let previous: unknown = "not called";
    setQueryData("me", (value) => { previous = value; return { name: "second member" }; });
    expect(previous).toBeUndefined();
    await clearQueryCache();
  });
});
