import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => {
  const data = new Map<string, string>();
  return {
    data,
    getAllKeys: vi.fn(async () => [...data.keys()]),
    getItem: vi.fn(async (key: string) => data.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { data.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { data.delete(key); }),
  };
});
vi.mock("@react-native-async-storage/async-storage", () => ({ default: storage }));
vi.mock("react-native", () => ({ AppState: { addEventListener: vi.fn() } }));

import { beginQuerySession, clearQueryCache, hydrateQueryCache, setQueryData } from "../src/api/query";

describe("query cache session boundary", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    storage.data.clear();
    await clearQueryCache();
  });

  it("waits for a pending write before clearing and rejects writes while signed out", async () => {
    beginQuerySession();
    await hydrateQueryCache();
    let finish!: () => void;
    storage.setItem.mockImplementationOnce((key, value) => new Promise<void>((resolve) => {
      finish = () => { storage.data.set(key, value); resolve(); };
    }));
    setQueryData("me", () => ({ name: "first member" }));
    const clearing = clearQueryCache();
    setQueryData("me", () => ({ name: "late write" }));
    finish();
    await clearing;
    expect(storage.data.has("rq:me")).toBe(false);
    beginQuerySession();
    setQueryData("me", () => ({ name: "second member" }));
    await Promise.resolve();
    expect(storage.data.get("rq:me")).toContain("second member");
  });

  it("propagates cleanup failure so a new login can be blocked", async () => {
    storage.data.set("rq:me", "private");
    storage.removeItem.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(clearQueryCache()).rejects.toThrow("storage unavailable");
  });

  it("ignores a previous session's hydration after a new session starts", async () => {
    storage.data.set("rq:me", JSON.stringify({ d: { name: "first member" }, t: 1 }));
    let finishRead!: (value: string | null) => void;
    let readStarted!: () => void;
    const started = new Promise<void>((resolve) => { readStarted = resolve; });
    storage.getItem.mockImplementationOnce(() => {
      readStarted();
      return new Promise((resolve) => { finishRead = resolve; });
    });
    beginQuerySession();
    const hydration = hydrateQueryCache();
    await started;
    await clearQueryCache();
    beginQuerySession();
    finishRead(JSON.stringify({ d: { name: "first member" }, t: 1 }));
    await hydration;
    let previous: unknown = "not called";
    setQueryData("me", (value) => { previous = value; return { name: "second member" }; });
    expect(previous).toBeUndefined();
  });

  it("shares a pending cleanup so concurrent callers both wait for deletion", async () => {
    storage.data.set("rq:me", "private");
    let finishRemoval!: () => void;
    let removalStarted!: () => void;
    const started = new Promise<void>((resolve) => { removalStarted = resolve; });
    storage.removeItem.mockImplementationOnce((key) => {
      removalStarted();
      return new Promise<void>((resolve) => {
        finishRemoval = () => { storage.data.delete(key); resolve(); };
      });
    });
    const first = clearQueryCache();
    await started;
    let secondFinished = false;
    const second = clearQueryCache().then(() => { secondFinished = true; });
    await Promise.resolve();
    expect(secondFinished).toBe(false);
    finishRemoval();
    await Promise.all([first, second]);
    expect(storage.data.has("rq:me")).toBe(false);
  });
});
