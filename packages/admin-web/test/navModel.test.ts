// Portal v2 nav model — structure + title resolution. Role-based gating returns
// with RBAC (P3); for now the shell shows the full nav and resolves page titles.
import { describe, it, expect } from "vitest";
import { navGroups, titleFor } from "../src/components/shell/nav";

describe("portal nav model", () => {
  it("has the nine sidebar groups in order", () => {
    // Follow-up became its own group on 2026-08-17 (owner ruling), sitting
    // between Operations and Communication. It was previously two rows inside
    // Operations gated on members:view.
    //
    // Website joined on 2026-08-22, before Settings: the portal is now the
    // administration point for nuruplace.org, and the whole group is gated on
    // the `website` module so running the site does not require Admin over
    // members, finance and curriculum.
    expect(navGroups.map((g) => g.label)).toEqual([
      "Portal", "Curriculum", "Media", "Operations", "Follow-up", "Communication", "System",
      "Website", "Settings",
    ]);
  });

  it("gates the Website group on its own module, so the site can be run without the roll", () => {
    const website = navGroups.find((g) => g.label === "Website");
    expect(website?.items.map((i) => i.path)).toEqual(["/website/enquiries"]);
    // Same principle as Follow-up: editing the church website and reading the
    // membership roster are different jobs, usually done by different people.
    expect(website?.items.every((i) => i.permission === "website:view")).toBe(true);
  });

  it("gates the Follow-up group on its own module, not on members:view", () => {
    const followUp = navGroups.find((g) => g.label === "Follow-up");
    expect(followUp?.items.map((i) => i.path)).toEqual(["/services", "/follow-up"]);
    // The whole point of migration 198: reading the member roll and working the
    // call list are different jobs, often done by different people.
    expect(followUp?.items.every((i) => i.permission === "followUp:view")).toBe(true);
  });

  it("no longer carries Services or Follow-up inside Operations", () => {
    const ops = navGroups.find((g) => g.label === "Operations");
    expect(ops?.items.some((i) => i.path === "/services" || i.path === "/follow-up")).toBe(false);
  });

  it("exposes the Media section (Video Library, Radio Studio, Audio Mixer, Uploads & Sessions)", () => {
    const media = navGroups.find((g) => g.label === "Media");
    expect(media?.items.map((i) => i.path)).toEqual(["/video-library", "/radio", "/mixer", "/uploads-sessions"]);
    expect(titleFor("/uploads-sessions")).toBe("Uploads & Sessions");
  });

  it("exposes Communication (Chat, Broadcast, SMS Center) and Settings (Users, Roles, Congregations, Countries, Languages)", () => {
    const comms = navGroups.find((g) => g.label === "Communication");
    // SMS Center joined on 2026-08-23: bulk campaigns with per-person delivery
    // truth. Coarse Admin+ gate server-side, so no permission key here.
    expect(comms?.items.map((i) => i.path)).toEqual(["/chat", "/broadcast", "/sms"]);
    expect(titleFor("/sms")).toBe("SMS Center");
    const settings = navGroups.find((g) => g.label === "Settings");
    expect(settings?.items.map((i) => i.path)).toEqual(["/users", "/roles", "/congregations", "/countries", "/languages"]);
  });

  it("exposes the System section (Member Intelligence, Flock Brief, Suggested Pairings)", () => {
    const system = navGroups.find((g) => g.label === "System");
    expect(system?.items.map((i) => i.path)).toEqual(["/intelligence", "/flock-brief", "/proximity"]);
  });

  it("every nav item has a unique path", () => {
    const paths = navGroups.flatMap((g) => g.items.map((i) => i.path));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("resolves static and param-route titles", () => {
    expect(titleFor("/")).toBe("Dashboard");
    expect(titleFor("/cell-engagement")).toBe("Cell Engagement");
    expect(titleFor("/cell-engagement/abc")).toBe("Cell Detail");
    expect(titleFor("/cms/level/3")).toBe("CMS — Level Detail");
  });

  it("falls back to the brand name for unknown routes", () => {
    expect(titleFor("/totally-unknown")).toBe("Nuru Pathway");
  });
});
