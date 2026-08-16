// Contract drift guard: every mounted Express route must appear in the OpenAPI
// paths, and vice versa (§3.7). Path-level parity (/v1 prefix stripped, :param →
// {param}). Catches a route added without updating the wire contract, or the reverse.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeApp } from "./helpers/app.js";

const here = dirname(fileURLToPath(import.meta.url));
const OPENAPI = join(here, "..", "..", "shared", "src", "openapi", "openapi.yaml");

/* eslint-disable @typescript-eslint/no-explicit-any */
function mountedPaths(app: any): Set<string> {
  const out = new Set<string>();
  const toOpenApi = (p: string) => p.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
  const walk = (stack: any[], prefix: string): void => {
    for (const layer of stack) {
      if (layer.route) {
        // Express accepts an ARRAY of paths for one handler — we use that to
        // keep a deprecated alias mounted beside its canonical path. `route.path`
        // is then the array itself, and naively concatenating it yields one
        // comma-joined pseudo-path that matches nothing in the spec, so both the
        // real paths read as undocumented AND both documented paths read as
        // unimplemented. Each entry is its own route and is checked as one.
        for (const p of Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path]) {
          out.add(toOpenApi(prefix + String(p)));
        }
      } else if (layer.name === "router" && layer.handle?.stack) {
        const m = /^\^\\\/((?:[^\\]|\\.)*?)\\\/\?/.exec(layer.regexp?.source ?? "");
        const mount = m ? "/" + m[1].replace(/\\(.)/g, "$1") : "";
        walk(layer.handle.stack, prefix + mount);
      }
    }
  };
  walk(app._router.stack, "");
  return out;
}

function openapiPaths(): Set<string> {
  const yaml = readFileSync(OPENAPI, "utf8");
  // Only the paths section: top-level keys under `paths:` that start with `/`.
  const section = yaml.slice(yaml.indexOf("\npaths:"), yaml.indexOf("\ncomponents:"));
  return new Set([...section.matchAll(/^ {2}(\/[^\s:]*):/gm)].map((mm) => mm[1]!));
}

describe("OpenAPI ↔ route parity (§3.7)", () => {
  it("every mounted route is documented and every documented path is mounted", () => {
    const app = makeApp();
    const routes = [...mountedPaths(app)]
      .map((p) => (p === "/v1" ? "" : p.startsWith("/v1/") ? p.slice(3) : p))
      .filter((p) => p.length > 0);

    const spec = openapiPaths();
    const routeSet = new Set(routes);

    // Documented paths that are deliberately NOT Express routes: WebSocket
    // upgrade endpoints attach to the HTTP server (server.on("upgrade")), so
    // they never appear in the router but belong in the spec.
    const WEBSOCKET_PATHS = new Set(["/admin/radio/mic-bridge"]);

    const undocumented = [...routeSet].filter((p) => !spec.has(p));
    const unimplemented = [...spec].filter((p) => !routeSet.has(p) && !WEBSOCKET_PATHS.has(p));

    expect({ undocumented, unimplemented }).toEqual({ undocumented: [], unimplemented: [] });
  });
});
