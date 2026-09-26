// Funds → New fund / Edit fund (finance:manage). POST /admin/finance/funds
// creates one — its code is a permanent slug (the ledger account is
// fund:<code>); PATCH /admin/finance/funds/:code renames, describes, reorders
// and (de)activates. Funds are never deleted. Deactivating a fund that money
// still routes to answers 409 FUND_IN_USE with the counts; "Deactivate anyway"
// asks once more and resends with force: true.
import { useId, useState, type ReactElement } from "react";
import { FinanceApi, FINANCE_LIMITS, financeErrorCode, financeErrorMessage, type BooksFund, type BooksFundPatch, type FinanceFundRow } from "../../../api/finance";
import { Button, ConfirmDialog, Drawer, FIN, Field, Notice, inputStyle, textareaStyle } from "../kit";
import { codeError, fundInUse, fundInUseText, lengthError, suggestCode, type FundInUse } from "./helpers";
import { Explain } from "./ui";

export interface FundFormDrawerProps {
  /** null = a new fund. */
  fund: FinanceFundRow | null;
  onClose: () => void;
  onSaved: (fund: BooksFund, action: "created" | "updated") => void;
}

/** The fields that changed, as a PATCH body (the API wants at least one). */
export function fundPatch(
  before: Pick<FinanceFundRow, "name" | "name_sw" | "description" | "sort" | "is_active">,
  after: { name: string; name_sw: string; description: string; sort: number; is_active: boolean },
): BooksFundPatch {
  const p: BooksFundPatch = {};
  const nameSw = after.name_sw.trim() || null;
  const desc = after.description.trim() || null;
  if (after.name.trim() !== before.name) p.name = after.name.trim();
  if (nameSw !== (before.name_sw ?? null)) p.name_sw = nameSw;
  if (desc !== (before.description ?? null)) p.description = desc;
  if (after.sort !== before.sort) p.sort = after.sort;
  if (after.is_active !== before.is_active) p.is_active = after.is_active;
  return p;
}

export function FundFormDrawer({ fund, onClose, onSaved }: FundFormDrawerProps): ReactElement {
  const creating = fund === null;
  const ids = { name: useId(), nameSw: useId(), code: useId(), desc: useId(), sort: useId(), active: useId() };
  const [name, setName] = useState(fund?.name ?? "");
  const [nameSw, setNameSw] = useState(fund?.name_sw ?? "");
  const [code, setCode] = useState(fund?.code ?? "");
  const [codeTouched, setCodeTouched] = useState(false);
  const [description, setDescription] = useState(fund?.description ?? "");
  const [sortText, setSortText] = useState(String(fund?.sort ?? 0));
  const [active, setActive] = useState(fund?.is_active ?? true);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inUse, setInUse] = useState<FundInUse | null>(null);
  const [forceAsk, setForceAsk] = useState(false);

  const sort = /^-?\d{1,6}$/.test(sortText.trim()) ? Number(sortText.trim()) : NaN;
  const errors = {
    name: lengthError(name, FINANCE_LIMITS.fundName, "a name"),
    nameSw: nameSw.trim() ? lengthError(nameSw, FINANCE_LIMITS.fundName, "the Swahili name") : null,
    code: creating ? codeError(code) : null,
    description: lengthError(description, { max: 500 }, "a description"),
    sort: Number.isNaN(sort) ? "A whole number — lower numbers list first." : null,
  };
  const valid = Object.values(errors).every((e) => e === null);
  const shown = attempted ? errors : { ...errors, name: null, code: codeTouched ? errors.code : null };
  const patch = fund ? fundPatch(fund, { name, name_sw: nameSw, description, sort: Number.isNaN(sort) ? fund.sort : sort, is_active: active }) : null;
  const nothingChanged = patch !== null && Object.keys(patch).length === 0;

  const onName = (v: string): void => {
    setName(v);
    if (creating && !codeTouched) setCode(suggestCode(v));
  };

  const save = async (force = false): Promise<void> => {
    setAttempted(true);
    if (!valid || busy || nothingChanged) return;
    setBusy(true);
    setError(null);
    try {
      if (creating) {
        const f = await FinanceApi.createFund({
          code,
          name: name.trim(),
          name_sw: nameSw.trim() || null,
          description: description.trim() || null,
          sort,
          is_active: active,
        });
        onSaved(f, "created");
      } else if (fund && patch) {
        const f = await FinanceApi.updateFund(fund.code, force ? { ...patch, force: true } : patch);
        onSaved(f, "updated");
      }
    } catch (e) {
      const used = fundInUse(e);
      if (used) {
        setInUse(used);
      } else if (financeErrorCode(e) === "CONFLICT" && creating) {
        setError(`A fund with the code “${code}” already exists — codes are permanent, so pick another.`);
      } else {
        setError(financeErrorMessage(e, creating ? "The fund was not created." : "The fund was not saved."));
      }
    } finally {
      setBusy(false);
    }
  };

  const fundLabel = name.trim() || fund?.name || "this fund";
  return (
    <>
      <Drawer
        open
        title={creating ? "New fund" : `Edit ${fund?.name ?? "fund"}`}
        subtitle={creating ? "A place money is given to and spent from — e.g. Tithe, Building, Missions." : `fund:${fund?.code ?? ""}`}
        onClose={onClose}
        width={560}
        footer={
          <>
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" busy={busy} disabled={nothingChanged || Boolean(inUse)} onClick={() => void save(false)}>
              {creating ? "Create fund" : nothingChanged ? "Nothing to save" : "Save changes"}
            </Button>
          </>
        }
      >
        <div style={{ display: "grid", gap: 16 }}>
          <Field label="Name" htmlFor={ids.name} required error={shown.name}>
            <input id={ids.name} data-autofocus value={name} maxLength={FINANCE_LIMITS.fundName.max} onChange={(e) => onName(e.target.value)} placeholder="e.g. Building Fund" style={inputStyle} />
          </Field>
          <Field label="Name in Swahili" htmlFor={ids.nameSw} error={shown.nameSw} hint="Optional — shown to members who use the app in Swahili.">
            <input id={ids.nameSw} value={nameSw} maxLength={FINANCE_LIMITS.fundName.max} onChange={(e) => setNameSw(e.target.value)} placeholder="e.g. Mfuko wa Ujenzi" style={inputStyle} />
          </Field>
          <Field
            label="Code"
            htmlFor={ids.code}
            required={creating}
            error={shown.code}
            hint={
              creating
                ? "Permanent: lowercase letters, digits and hyphens, starting with a letter (2–40). The ledger account becomes fund:<code>, so it can never change."
                : "Permanent — the ledger account fund:<code> carries every posting ever made to this fund, so the code never changes. Rename it instead."
            }
          >
            <input
              id={ids.code}
              value={code}
              readOnly={!creating}
              aria-readonly={!creating}
              maxLength={40}
              onChange={(e) => {
                setCodeTouched(true);
                setCode(e.target.value.toLowerCase());
              }}
              style={{ ...inputStyle, fontFamily: FIN.mono, background: creating ? FIN.input : FIN.surface, color: creating ? FIN.navy : FIN.muted }}
            />
          </Field>
          <Field label="Description" htmlFor={ids.desc} error={shown.description} hint={`Optional — what the fund is for. ${description.trim().length} / 500`}>
            <textarea id={ids.desc} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} style={textareaStyle} />
          </Field>
          <Field label="Sort order" htmlFor={ids.sort} error={shown.sort} hint="Lower numbers list first in pickers and on the Funds page.">
            <input id={ids.sort} inputMode="numeric" value={sortText} onChange={(e) => setSortText(e.target.value)} style={{ ...inputStyle, width: 120, fontFamily: FIN.mono }} />
          </Field>
          <label htmlFor={ids.active} className="flex items-start gap-2" style={{ fontSize: 13, color: FIN.navy, cursor: "pointer" }}>
            <input
              id={ids.active}
              type="checkbox"
              checked={active}
              onChange={(e) => {
                setActive(e.target.checked);
                setInUse(null);
              }}
              style={{ marginTop: 3 }}
            />
            <span>
              <span style={{ fontWeight: 600 }}>Active</span>
              <Explain>
                An inactive fund is hidden from new gifts and can&apos;t receive transfers; everything already in it — history and balance — stays. Money can still be moved out of it.
              </Explain>
            </span>
          </label>
          {inUse ? (
            <Notice
              tone="warn"
              action={
                <span className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      setInUse(null);
                      setActive(true);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setForceAsk(true)}>
                    Deactivate anyway
                  </Button>
                </span>
              }
            >
              {fundInUseText(fundLabel, inUse)}
            </Notice>
          ) : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
        </div>
      </Drawer>
      <ConfirmDialog
        open={forceAsk}
        title={`Deactivate ${fundLabel} anyway?`}
        tone="danger"
        confirmLabel="Deactivate anyway"
        body={
          <>
            {inUse ? fundInUseText(fundLabel, inUse) : null} Nothing already given is touched; the fund can be made active again at any time.
          </>
        }
        onCancel={() => setForceAsk(false)}
        onConfirm={async () => {
          setForceAsk(false);
          setInUse(null);
          await save(true);
        }}
      />
    </>
  );
}
