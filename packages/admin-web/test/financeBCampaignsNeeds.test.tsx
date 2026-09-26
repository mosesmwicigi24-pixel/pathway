// @vitest-environment happy-dom
// Finance → Campaigns and Finance → Department needs: campaign writes need
// finance:manage and always start as a draft, a match is never saved without
// its pledger, going live asks first, reach counts (BIGINT text) are read as
// numbers; needs come from the Finance endpoint and link to Departments only
// for someone who can open it.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { FinanceApi, type CampaignRow, type FinanceNeedRow, type FinanceNeedsPage } from "../src/api/finance";
import { FinanceCampaigns } from "../src/components/pages/finance/Campaigns";
import { FinanceNeeds } from "../src/components/pages/finance/Needs";
import { ALL_FINANCE, renderPage } from "./financeBSetup";

vi.mock("../src/api/finance", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/api/finance")>();
  return {
    ...mod,
    FinanceApi: {
      ...mod.FinanceApi,
      campaigns: vi.fn(),
      createCampaign: vi.fn(),
      updateCampaign: vi.fn(),
      goLive: vi.fn(),
      endCampaign: vi.fn(),
      campaignReach: vi.fn(),
      config: vi.fn(),
      needs: vi.fn(),
    },
  };
});

afterEach(cleanup);

const campaign = (over: Partial<CampaignRow>): CampaignRow => ({
  campaign_id: "cmp1",
  title: "Roof appeal",
  blurb: "Replace the sanctuary roof before the rains.",
  image_url: null,
  goal_minor: 50_000_000,
  currency: "KES",
  starts_on: "2026-09-01",
  ends_on: "2026-12-31",
  status: "live",
  match_minor: 10_000_000,
  match_pledger: "The elders",
  fund: "building",
  created_at: "2026-08-20T09:00:00Z",
  raised_minor: 12_000_000,
  people_asked: "40",
  gave: "12",
  declined: "3",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(FinanceApi.config).mockResolvedValue({
    funds: [
      { code: "building", name: "Building Fund", is_active: true },
      { code: "general", name: "General Fund", is_active: true },
    ],
    providers: [],
    step_up_required: true,
  });
  vi.mocked(FinanceApi.campaigns).mockResolvedValue([campaign({}), campaign({ campaign_id: "cmp2", title: "Missions week", status: "draft", match_minor: null, match_pledger: null, raised_minor: 0, people_asked: "0", gave: "0", declined: "0" })]);
  vi.mocked(FinanceApi.campaignReach).mockResolvedValue({ people_asked: "40", times_shown: "95", opened: "22", gave: "12", dismissed: "9", declined: "3" });
  vi.mocked(FinanceApi.createCampaign).mockResolvedValue({ campaign_id: "cmp3", status: "draft" });
  vi.mocked(FinanceApi.goLive).mockResolvedValue({ campaign_id: "cmp2", status: "live" });
});

describe("Campaigns (/finance/campaigns)", () => {
  it("shows raised of goal, the match with its pledger, and reach as numbers", async () => {
    renderPage(<FinanceCampaigns />, { path: "/finance/campaigns" });
    await screen.findByText("Roof appeal");
    expect(screen.getAllByText("24%").length).toBeGreaterThan(0);
    expect(screen.getByText("pledged by The elders")).toBeTruthy();
    // Hero: people asked in live campaigns — "40" (text) read as a number.
    expect(screen.getByText("12 gave")).toBeTruthy();
  });

  it("offers no writes without finance:manage", async () => {
    renderPage(<FinanceCampaigns />, { path: "/finance/campaigns", permissions: ["finance:view"] });
    await screen.findByText("Roof appeal");
    expect(screen.queryByText("New campaign")).toBeNull();
    expect(screen.queryByText("Go live")).toBeNull();
    expect(screen.queryByText("End")).toBeNull();
    expect(screen.queryByText("Edit")).toBeNull();
  });

  it("creates a draft in minor units, and refuses a match nobody pledged", async () => {
    renderPage(<FinanceCampaigns />, { path: "/finance/campaigns", permissions: ALL_FINANCE });
    fireEvent.click(await screen.findByText("New campaign"));
    const drawer = await screen.findByRole("dialog", { name: "New campaign" });
    fireEvent.change(within(drawer).getByLabelText(/Title/), { target: { value: "Youth camp" } });
    fireEvent.change(within(drawer).getByLabelText(/What it is for/), { target: { value: "Send forty young people to camp in December." } });
    fireEvent.change(within(drawer).getByLabelText(/Gifts go to/), { target: { value: "general" } });
    const [goal, match] = within(drawer).getAllByPlaceholderText(/0\.00|No match/);
    fireEvent.change(goal as HTMLElement, { target: { value: "250,000" } });
    fireEvent.change(match as HTMLElement, { target: { value: "50000" } });
    await act(async () => {
      fireEvent.click(within(drawer).getByText("Create draft"));
    });
    expect(FinanceApi.createCampaign).not.toHaveBeenCalled();
    expect(within(drawer).getByText(/Name who pledged the match/)).toBeTruthy();
    fireEvent.change(within(drawer).getByLabelText(/Matched by/), { target: { value: "Mr & Mrs Kamau" } });
    await act(async () => {
      fireEvent.click(within(drawer).getByText("Create draft"));
    });
    expect(FinanceApi.createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Youth camp", fund: "general", goal_minor: 25_000_000, currency: "KES", match_minor: 5_000_000, match_pledger: "Mr & Mrs Kamau" }),
    );
    await waitFor(() => expect(screen.getByText(/Created “Youth camp” as a draft/)).toBeTruthy());
  });

  it("asks before going live, then puts it live", async () => {
    renderPage(<FinanceCampaigns />, { path: "/finance/campaigns" });
    await screen.findByText("Missions week");
    fireEvent.click(screen.getByText("Go live"));
    const dialog = await screen.findByRole("alertdialog", { name: "Put “Missions week” live?" });
    expect(dialog.textContent).toContain("members can be invited");
    await act(async () => {
      fireEvent.click(within(dialog).getByText("Go live"));
    });
    expect(FinanceApi.goLive).toHaveBeenCalledWith("cmp2");
  });

  it("opens a campaign's reach", async () => {
    renderPage(<FinanceCampaigns />, { path: "/finance/campaigns" });
    fireEvent.click(await screen.findByText("Roof appeal"));
    const drawer = await screen.findByRole("dialog", { name: "Roof appeal" });
    await waitFor(() => expect(FinanceApi.campaignReach).toHaveBeenCalledWith("cmp1"));
    expect(await within(drawer).findByText("95")).toBeTruthy();
    expect(within(drawer).getByText(/12 of 40 people asked gave \(30%\)/)).toBeTruthy();
  });
});

const need = (over: Partial<FinanceNeedRow>): FinanceNeedRow => ({
  need_id: "n1",
  title: "New sound desk",
  why: "The old desk hums on every mic.",
  department_id: "d1",
  department_name: "Worship & Media",
  fund_code: "general",
  target_minor: 30_000_000,
  raised_minor: 7_500_000,
  gifts_count: 14,
  currency: "KES",
  deadline: null,
  status: "approved",
  created_at: "2026-08-01T09:00:00Z",
  decided_at: "2026-08-02T09:00:00Z",
  ...over,
});
const needsPage = (rows: FinanceNeedRow[]): FinanceNeedsPage => ({
  data: rows,
  next_cursor: null,
  totals: [
    { currency: "KES", amount_minor: 7_500_000, count: 1, target_minor: 30_000_000, raised_minor: 7_500_000 },
    { currency: "USD", amount_minor: 10_000, count: 1, target_minor: 50_000, raised_minor: 10_000 },
  ],
});

describe("Department needs (/finance/needs)", () => {
  it("reads the Finance endpoint (approved by default) with totals per currency", async () => {
    vi.mocked(FinanceApi.needs).mockResolvedValue(needsPage([need({}), need({ need_id: "n2", title: "Mission van fuel", currency: "USD", target_minor: 50_000, raised_minor: 10_000, fund_code: null })]));
    renderPage(<FinanceNeeds />, { path: "/finance/needs", permissions: ["finance:view"] });
    await screen.findByText("New sound desk");
    expect(FinanceApi.needs).toHaveBeenCalledWith(expect.objectContaining({ status: "approved" }));
    expect(screen.getByText("25%")).toBeTruthy();
    expect(screen.getByText("KES 225,000.00 to go")).toBeTruthy();
    expect(screen.getByText("The gift's own fund")).toBeTruthy();
    const groups = [...document.querySelectorAll("[data-currency]")];
    expect(groups.map((g) => g.getAttribute("data-currency"))).toEqual(["KES", "USD"]);
    // finance:view only — no link into Departments.
    expect(screen.queryByText("Review in Departments")).toBeNull();
  });

  it("links to Departments only with departments:view", async () => {
    vi.mocked(FinanceApi.needs).mockResolvedValue(needsPage([need({})]));
    renderPage(<FinanceNeeds />, { path: "/finance/needs?status=pending", permissions: ["finance:view", "departments:view"] });
    await screen.findByText("New sound desk");
    expect(FinanceApi.needs).toHaveBeenCalledWith(expect.objectContaining({ status: "pending" }));
    const links = screen.getAllByText("Review in Departments");
    expect(links.length).toBe(2); // the hero's, and the row's
    fireEvent.click(links[1] as HTMLElement);
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/departments?department=d1"));
  });
});
