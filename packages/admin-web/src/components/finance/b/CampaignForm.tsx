// The campaign create / edit drawer (Finance → Campaigns; financial/campaigns.ts).
// A new campaign is always a draft — nothing reaches a member until it is put
// live, separately. A match is only ever saved with the person who pledged it.
import { useEffect, useId, useState, type ReactElement } from "react";
import { FinanceApi, financeErrorMessage, type CampaignRow } from "../../../api/finance";
import { Button, Drawer, FIN, Field, MoneyInput, Notice, inputStyle, selectStyle, textareaStyle, useFinanceToast } from "../kit";
import { minorToMajorInput } from "../money";
import { todayEAT } from "../dates";
import { addDaysIso, validateCampaignForm, type CampaignForm, type CampaignFormErrors } from "./logic";
import type { FundOption } from "./hooks";

const CURRENCIES = ["KES", "USD"] as const;

function formFrom(c: CampaignRow | null): CampaignForm {
  const today = todayEAT();
  if (!c) {
    return { title: "", blurb: "", image_url: "", fund: "", goal: "", currency: "KES", starts_on: today, ends_on: addDaysIso(today, 30), match: "", match_pledger: "" };
  }
  return {
    title: c.title,
    blurb: c.blurb,
    image_url: c.image_url ?? "",
    fund: c.fund ?? "",
    goal: minorToMajorInput(c.goal_minor),
    currency: c.currency,
    starts_on: c.starts_on,
    ends_on: c.ends_on,
    match: c.match_minor !== null ? minorToMajorInput(c.match_minor) : "",
    match_pledger: c.match_pledger ?? "",
  };
}

export function CampaignFormDrawer({
  open,
  campaign,
  funds,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null = a new campaign. */
  campaign: CampaignRow | null;
  funds: readonly FundOption[];
  onClose: () => void;
  onSaved: (campaignId: string) => void;
}): ReactElement | null {
  const toast = useFinanceToast();
  const ids = useId();
  const [form, setForm] = useState<CampaignForm>(() => formFrom(campaign));
  const [errors, setErrors] = useState<CampaignFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(formFrom(campaign));
      setErrors({});
      setServerError(null);
      setTried(false);
    }
  }, [open, campaign]);

  const set = <K extends keyof CampaignForm>(k: K, v: CampaignForm[K]): void => {
    setForm((f) => ({ ...f, [k]: v }));
    if (tried) setErrors(validateCampaignForm({ ...form, [k]: v }).errors);
  };

  // Active funds, plus the campaign's own fund even if it has since been retired.
  const fundChoices = funds.filter((f) => f.is_active || f.code === campaign?.fund);

  const save = async (): Promise<void> => {
    setTried(true);
    const v = validateCampaignForm(form);
    setErrors(v.errors);
    if (!v.body || busy) return;
    setBusy(true);
    setServerError(null);
    try {
      const r = campaign ? await FinanceApi.updateCampaign(campaign.campaign_id, v.body) : await FinanceApi.createCampaign(v.body);
      toast(campaign ? `Saved “${v.body.title}”` : `Created “${v.body.title}” as a draft — nothing reaches members until you put it live`);
      onSaved(r.campaign_id);
    } catch (e) {
      setServerError(financeErrorMessage(e, campaign ? "Could not save the campaign." : "Could not create the campaign."));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  const live = campaign?.status === "live";
  return (
    <Drawer
      open={open}
      title={campaign ? "Edit campaign" : "New campaign"}
      subtitle={campaign ? campaign.title : "Starts as a draft — putting it live is a separate step."}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            {campaign ? "Save changes" : "Create draft"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {live ? <Notice tone="warn">This campaign is live — members being invited see the changes at once.</Notice> : null}
        {serverError ? <Notice tone="error">{serverError}</Notice> : null}
        <Field label="Title" htmlFor={`${ids}-title`} required error={errors.title}>
          <input id={`${ids}-title`} data-autofocus value={form.title} maxLength={120} onChange={(e) => set("title", e.target.value)} style={inputStyle} />
        </Field>
        <Field label="What it is for" htmlFor={`${ids}-blurb`} required error={errors.blurb} hint="What members read when they are invited — a sentence or two.">
          <textarea id={`${ids}-blurb`} value={form.blurb} onChange={(e) => set("blurb", e.target.value)} style={textareaStyle} />
        </Field>
        <Field label="Gifts go to" htmlFor={`${ids}-fund`} required error={errors.fund} hint="Money raised = succeeded gifts to this fund between the start and end dates.">
          <select id={`${ids}-fund`} value={form.fund} onChange={(e) => set("fund", e.target.value)} style={{ ...selectStyle, width: "100%" }}>
            <option value="">Choose a fund…</option>
            {fundChoices.map((f) => (
              <option key={f.code} value={f.code}>
                {f.name}
                {f.is_active ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Goal" htmlFor={`${ids}-goal`} required>
          <MoneyInput id={`${ids}-goal`} value={form.goal} currency={form.currency} currencies={CURRENCIES} onCurrencyChange={(c) => set("currency", c)} onChange={(t) => set("goal", t)} showError={tried} />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: 12 }}>
          <Field label="Starts" htmlFor={`${ids}-starts`} required error={errors.starts_on}>
            <input id={`${ids}-starts`} type="date" value={form.starts_on} onChange={(e) => set("starts_on", e.target.value)} style={{ ...inputStyle, fontFamily: FIN.mono }} />
          </Field>
          <Field label="Ends" htmlFor={`${ids}-ends`} required error={errors.ends_on} hint="A campaign always ends — gifts after this day do not count toward it.">
            <input id={`${ids}-ends`} type="date" value={form.ends_on} min={form.starts_on || undefined} onChange={(e) => set("ends_on", e.target.value)} style={{ ...inputStyle, fontFamily: FIN.mono }} />
          </Field>
        </div>
        <div style={{ borderTop: `1px solid ${FIN.border}`, paddingTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12.5, color: FIN.muted }}>
            <strong style={{ color: FIN.navy }}>Match (optional).</strong> Only when someone has actually pledged to match gifts — the pledger is named, so a match nobody offered is never claimed.
          </div>
          <Field label="Match amount" htmlFor={`${ids}-match`} error={form.match.trim() === "" ? errors.match : undefined}>
            <MoneyInput id={`${ids}-match`} value={form.match} currency={form.currency} onChange={(t) => set("match", t)} placeholder="No match" />
          </Field>
          <Field label="Matched by" htmlFor={`${ids}-pledger`} error={errors.match_pledger}>
            <input id={`${ids}-pledger`} value={form.match_pledger} maxLength={120} placeholder="Who pledged the match" onChange={(e) => set("match_pledger", e.target.value)} style={inputStyle} />
          </Field>
        </div>
        <Field label="Image address (optional)" htmlFor={`${ids}-image`} error={errors.image_url}>
          <input id={`${ids}-image`} value={form.image_url} placeholder="https://…" onChange={(e) => set("image_url", e.target.value)} style={inputStyle} />
        </Field>
      </div>
    </Drawer>
  );
}
