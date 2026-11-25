// Mobile sync engine + local store — pure logic, no React Native runtime.
import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryLocalStore } from "../src/db/inMemoryLocalStore";
import { AsyncStorageLocalStore } from "../src/db/asyncStorageLocalStore";
import { MemoryKeyValueStore } from "../src/db/keyValueStore";
import { SyncEngine, type SyncApi } from "../src/sync/syncEngine";
import type { PendingMutation, SyncPullResponse, SyncPushResponse } from "@nuru/shared";

class FakeApi implements SyncApi {
  public lastPush: { mutations: PendingMutation[] } | null = null;
  public lastPullCursors: Record<string, number> | null = null;

  push(body: { device_id?: string; mutations: PendingMutation[] }): Promise<SyncPushResponse> {
    this.lastPush = body;
    return Promise.resolve({
      results: body.mutations.map((m) => ({ mutation_id: m.mutation_id, status: "applied" as const })),
    });
  }

  pull(body: { device_id?: string; cursors: Record<string, number> }): Promise<SyncPullResponse> {
    this.lastPullCursors = body.cursors;
    return Promise.resolve({
      changes: { module_progress: [{ op: "upsert", row: { progress_id: "p1", is_completed: true } }] },
      tombstones: { modules: ["m-old"] },
      cursors: { module_progress: 5 },
    });
  }
}

describe("SyncEngine + InMemoryLocalStore", () => {
  let store: InMemoryLocalStore;
  let api: FakeApi;
  let engine: SyncEngine;

  beforeEach(() => {
    store = new InMemoryLocalStore();
    api = new FakeApi();
    engine = new SyncEngine(api, store, "device-1");
  });

  it("assigns a monotonic per-device seq when enqueuing", async () => {
    const a = await engine.enqueue("module_progress", "complete", { module_id: "m1" });
    const b = await engine.enqueue("quiz_attempts", "submit", { module_id: "m1", answers: [] });
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect((await store.pendingMutations()).length).toBe(2);
  });

  it("assigns distinct ordered sequence numbers to concurrent enqueues", async () => {
    const persistent = new AsyncStorageLocalStore(new MemoryKeyValueStore());
    const sharedEngine = new SyncEngine(api, persistent, "device-1");
    const items = await Promise.all([
      sharedEngine.enqueue("module_progress", "complete", { module_id: "m1" }),
      sharedEngine.enqueue("module_progress", "complete", { module_id: "m2" }),
    ]);
    expect(items.map((item) => item.seq)).toEqual([1, 2]);
    expect(await persistent.pendingMutations()).toHaveLength(2);
  });

  it("does not block later enqueue attempts after a storage error", async () => {
    const kv = new MemoryKeyValueStore();
    const persistent = new AsyncStorageLocalStore(kv);
    const sharedEngine = new SyncEngine(api, persistent, "device-1");
    await kv.setItem("np:queue", "broken");
    await expect(sharedEngine.enqueue("module_progress", "complete", { module_id: "m1" })).rejects.toThrow();
    await kv.setItem("np:queue", "[]");
    await expect(sharedEngine.enqueue("module_progress", "complete", { module_id: "m2" })).resolves.toMatchObject({ seq: 1 });
  });

  it("push replays the queue and clears applied mutations", async () => {
    await engine.enqueue("module_progress", "complete", { module_id: "m1" });
    const res = await engine.push();
    expect(res?.results[0]?.status).toBe("applied");
    expect(api.lastPush?.mutations.length).toBe(1);
    expect(await store.pendingMutations()).toHaveLength(0); // queue drained
  });

  it("push is a no-op (null) with an empty queue", async () => {
    expect(await engine.push()).toBeNull();
  });

  it("retains work when the server returns an unknown status or an unrelated ID", async () => {
    let e: SyncEngine;
    const unusual: SyncApi = {
      pull: () => Promise.resolve({ changes: {}, tombstones: {}, cursors: {} }),
      push: async () => {
        await e.enqueue("module_progress", "complete", { module_id: "m2" });
        return { results: [
          { mutation_id: "ours", status: "pending" as "applied" },
          { mutation_id: "another", status: "applied" as const },
        ] };
      },
    };
    const ids = ["ours", "another"];
    e = new SyncEngine(unusual, store, "device-1", () => ids.shift()!);
    await e.enqueue("module_progress", "complete", { module_id: "m1" });
    await e.push();
    expect((await store.pendingMutations()).map((m) => m.mutation_id)).toEqual(["ours", "another"]);
  });

  it("drops a rejected mutation from the queue but surfaces its reason (§3.6)", async () => {
    const rejecting: SyncApi = {
      pull: () => Promise.resolve({ changes: {}, tombstones: {}, cursors: {} }),
      push: (body) =>
        Promise.resolve({
          results: body.mutations.map((m) => ({
            mutation_id: m.mutation_id,
            status: "rejected" as const,
            code: "GATE_LOCKED",
            detail: "module 4 not yet unlocked",
          })),
        }),
    };
    const e = new SyncEngine(rejecting, store, "device-1");
    await e.enqueue("module_progress", "complete", { module_id: "m4" });
    const res = await e.push();
    expect(res?.results[0]).toMatchObject({ status: "rejected", code: "GATE_LOCKED" });
    expect(await store.pendingMutations()).toHaveLength(0); // removed, not retried forever
  });

  it("pull caches upserts, applies tombstones, and advances cursors", async () => {
    await store.cacheUpsert("modules", "m-old", { module_id: "m-old", title: "Stale" });

    await engine.pull();

    expect(await store.cacheList("module_progress")).toEqual([{ progress_id: "p1", is_completed: true }]);
    expect(await store.cacheList("modules")).toEqual([]); // tombstoned
    expect(await store.getCursor("module_progress")).toBe(5);
  });

  it("pull sends the stored cursors back to the server", async () => {
    await store.setCursor("module_progress", 3);
    await engine.pull();
    expect(api.lastPullCursors?.module_progress).toBe(3);
  });

  it("a full sync pushes then pulls", async () => {
    await engine.enqueue("module_progress", "complete", { module_id: "m1" });
    const { push, pull } = await engine.sync();
    expect(push?.results).toHaveLength(1);
    expect(pull.cursors.module_progress).toBe(5);
  });
});
