// Persistent LocalStore (spec §1.7, §5.7) — durable across app restarts, backed
// by a KeyValueStore (AsyncStorage on device). The offline mutation queue, pull
// cursors, and the cached server rows survive a cold start, so queued writes
// replay on reconnect and screens render the last-known data offline.
//
// Key layout (all under the np: namespace):
//   np:queue                  → JSON array of PendingMutation (seq-ordered on read)
//   np:cursor:<domain>        → number
//   np:cache:<domain>:<id>    → JSON row
//
// Note: this is an unencrypted KV today; on a lost device the keychain still
// guards tokens (§5.7). A SQLCipher-backed store is the encryption follow-up and
// can replace this behind the same LocalStore interface.
import type { PendingMutation } from "@nuru/shared";
import type { LocalStore, SyncRow } from "./localStore.js";
import type { KeyValueStore } from "./keyValueStore.js";

const QUEUE_KEY = "np:queue";
const CURSOR_PREFIX = "np:cursor:";
const CACHE_PREFIX = "np:cache:";

export class AsyncStorageLocalStore implements LocalStore {
  private queueWrite: Promise<void> = Promise.resolve();

  constructor(private readonly kv: KeyValueStore) {}

  private mutateQueue(change: (queue: PendingMutation[]) => PendingMutation[]): Promise<void> {
    const operation = this.queueWrite.then(async () => {
      const queue = await this.readQueue();
      await this.writeQueue(change(queue));
    });
    // A failed write is returned to its caller, but must not poison later attempts.
    this.queueWrite = operation.catch(() => undefined);
    return operation;
  }

  private async readQueue(): Promise<PendingMutation[]> {
    const raw = await this.kv.getItem(QUEUE_KEY);
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.every((item: unknown) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return false;
        const row = item as Record<string, unknown>;
        return typeof row.mutation_id === "string" && row.mutation_id.length > 0 &&
          typeof row.seq === "number" && Number.isSafeInteger(row.seq) && row.seq > 0 &&
          typeof row.domain === "string" && row.domain.length > 0 &&
          typeof row.op === "string" && row.op.length > 0 &&
          !!row.payload && typeof row.payload === "object" && !Array.isArray(row.payload);
      })) throw new Error("Invalid queue format");
      return parsed as PendingMutation[];
    } catch {
      // The queue is the system of record: do not replace unreadable data with
      // an empty queue on the next write. Leave it intact for recovery.
      throw new Error("The offline mutation queue could not be read.");
    }
  }
  private writeQueue(q: PendingMutation[]): Promise<void> {
    return this.kv.setItem(QUEUE_KEY, JSON.stringify(q));
  }

  async enqueueMutation(m: PendingMutation): Promise<void> {
    await this.mutateQueue((q) => [...q, m]);
  }

  async pendingMutations(): Promise<PendingMutation[]> {
    await this.queueWrite;
    const q = await this.readQueue();
    return [...q].sort((a, b) => a.seq - b.seq);
  }

  async clearMutations(ids: string[]): Promise<void> {
    const drop = new Set(ids);
    await this.mutateQueue((q) => q.filter((m) => !drop.has(m.mutation_id)));
  }

  async getCursor(domain: string): Promise<number | undefined> {
    const raw = await this.kv.getItem(CURSOR_PREFIX + domain);
    if (raw === null) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }

  setCursor(domain: string, value: number): Promise<void> {
    return this.kv.setItem(CURSOR_PREFIX + domain, String(value));
  }

  cacheUpsert(domain: string, id: string, row: SyncRow): Promise<void> {
    return this.kv.setItem(`${CACHE_PREFIX}${domain}:${id}`, JSON.stringify(row));
  }

  cacheDelete(domain: string, id: string): Promise<void> {
    return this.kv.removeItem(`${CACHE_PREFIX}${domain}:${id}`);
  }

  async cacheList(domain: string): Promise<SyncRow[]> {
    const prefix = `${CACHE_PREFIX}${domain}:`;
    const keys = (await this.kv.getAllKeys()).filter((k) => k.startsWith(prefix));
    const rows: SyncRow[] = [];
    for (const k of keys) {
      const raw = await this.kv.getItem(k);
      if (raw) {
        try {
          rows.push(JSON.parse(raw) as SyncRow);
        } catch {
          /* skip corrupt row */
        }
      }
    }
    return rows;
  }
}
