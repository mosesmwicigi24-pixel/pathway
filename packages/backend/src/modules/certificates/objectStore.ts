// Object storage seam for rendered certificate PDFs (spec §4.5 "object storage
// holds rendered certificate PDFs"). The S3/Cloudinary implementation drops in
// behind this interface; InMemoryObjectStore backs tests and first-run dev,
// FsObjectStore persists under MEDIA_STORAGE_DIR so the worker (renderer) and the
// API (download route) share objects on a single-box deploy.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";
import type { Env } from "../../config/env.js";

export interface ObjectStore {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
}

export class InMemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, Buffer>();
  put(key: string, bytes: Buffer): Promise<void> {
    this.objects.set(key, bytes);
    return Promise.resolve();
  }
  get(key: string): Promise<Buffer | null> {
    return Promise.resolve(this.objects.get(key) ?? null);
  }
}

/** Disk-backed store rooted at a directory; keys map to relative paths. */
export class FsObjectStore implements ObjectStore {
  constructor(private readonly root: string) {}

  /** Resolve a key inside the root, rejecting traversal outside it. */
  private pathFor(key: string): string {
    const p = normalize(join(this.root, key));
    if (p !== this.root && !p.startsWith(this.root + sep)) {
      throw new Error(`Object key escapes the store root: ${key}`);
    }
    return p;
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch {
      return null;
    }
  }
}

/** Default store for a process: disk under MEDIA_STORAGE_DIR (shared between the
 *  API and the outbox worker), memory as the last-ditch fallback. */
export function buildObjectStore(env: Env): ObjectStore {
  const dir = env.MEDIA_STORAGE_DIR ?? "/tmp/nuru-media";
  return dir ? new FsObjectStore(join(dir, "objects")) : new InMemoryObjectStore();
}
