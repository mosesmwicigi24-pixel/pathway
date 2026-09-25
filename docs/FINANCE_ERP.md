# Finance — the ERP module (portal web + iPad)

Owner request 2026-09-26: make **Finance** a menu section (like Media) with a
full set of sub-pages on the web portal and the native iPad app, designed as an
ERP finance model; build, test and stress-test in ten top-to-bottom cycles, then
merge and deploy. This document is the contract every surface builds to.

Principles (unchanged from the rest of the platform): integer minor units +
ISO currency, never floats; the server is the only author of money and status;
every posting is double-entry and balanced; nothing is ever deleted — mistakes
are corrected by reversing entries; every write is permission-gated and audited;
multi-currency totals are always **per currency** (KES and USD are never added).

## 1. Menu (information architecture)

A new sidebar group **FINANCE** (web `nav.tsx` group; iPad `Section` group),
placed directly after OPERATIONS. Finance and Partners leave OPERATIONS
(Departments stays there; its money view is Finance → Department needs).
Order follows the ERP flow — money in → commitments → money out → planning →
books → reporting → admin:

| # | Label | Web route | iPad section | Gate |
|---|---|---|---|---|
| 1 | Overview | `/finance` | financeOverview | finance:view |
| 2 | Transactions | `/finance/transactions` | financeTransactions | finance:view |
| 3 | Pledges | `/finance/pledges` | financePledges | finance:view |
| 4 | Partners | `/finance/partners` (`/partners` redirects) | partners | finance:view |
| 5 | Claims | `/finance/claims` | financeClaims | finance:view |
| 6 | Recurring gifts | `/finance/recurring` | financeRecurring | finance:view |
| 7 | Campaigns | `/finance/campaigns` | financeCampaigns | finance:view |
| 8 | Department needs | `/finance/needs` | financeNeeds | finance:view |
| 9 | Expenses | `/finance/expenses` | financeExpenses | finance:view |
| 10 | Budgets | `/finance/budgets` | financeBudgets | finance:view |
| 11 | Funds | `/finance/funds` | financeFunds | finance:view |
| 12 | Ledger | `/finance/ledger` | financeLedger | finance:view |
| 13 | Reconciliation | `/finance/reconciliation` | financeReconciliation | finance:view |
| 14 | Reports | `/finance/reports` | financeReports | finance:view |
| 15 | Statements | `/finance/statements` | financeStatements | finance:view |
| 16 | Audit | `/finance/audit` | financeAudit | finance:view |
| 17 | Settings | `/finance/settings` | financeSettings | finance:view |

Every web sub-route is added to `pathPermissions` (exact-path guard) and gets a
page title; the breadcrumb reads "Finance · <page>" on both surfaces. Write
actions are shown only with the capability (see §6); while `/me` loads, write
actions are hidden (fail closed for writes, open for reads — matches the web).

## 2. Accounting model

Accounts (ledger `account` strings):
- `cash:<channel>` — where money sits: existing `cash:mpesa`, `cash:airtel`,
  `cash:stripe`, `cash:paypal`, `cash:manual` (legacy claims); new office
  channels `cash:onhand` (physical cash), `cash:bank`, `cash:cheque`.
  Offline M-Pesa recorded by the office posts to `cash:mpesa` (same till /
  paybill statement as online M-Pesa).
- `fund:<code>` — fund equity (income credits it, expenses and transfers out
  debit it). `sales:media` unchanged.

Postings (every one balanced: one debit, one credit, same amount + currency):
| Event | Debit | Credit | Owner |
|---|---|---|---|
| Online gift settles (existing) | cash:<provider> | fund:<code> | transaction |
| Office gift recorded (NEW) | cash:<channel> | fund:<code> | transaction (provider `manual`, source `admin`) |
| Office gift / manual claim reversed (NEW) | fund:<code> | cash:<channel> | same transaction; status → `refunded` |
| Expense approved (NEW) | fund:<code> | cash:<channel> | journal kind `expense` |
| Approved expense voided (NEW) | cash:<channel> | fund:<code> | journal kind `expense_void` |
| Fund transfer (NEW) | fund:<from> | fund:<to> | journal kind `transfer` |

- **Journals**: ledger entries gain a nullable `journal_id`; `transaction_id`
  becomes nullable; CHECK exactly one of them is set. Readers that join
  `transactions` keep working (they never saw journal rows); the Ledger, Trial
  balance, Funds and Reconciliation read both.
- **Office receipts**: EVERY office gift (all channels) gets a gapless office
  receipt `OR-<year>-<5 digits>` (row-locked counter, EAT year at recording
  time; a rolled-back attempt leaves no gap). The M-Pesa code, cheque number or
  bank reference goes in `office_reference` (M-Pesa codes trimmed, upper-cased,
  `^[A-Z0-9]{8,12}$`). An offline M-Pesa code that is already the receipt of a
  settled online payment, or of another live office M-Pesa entry, is refused
  (409 `DUPLICATE_RECEIPT`; unique index on `upper(office_reference)` for live
  office M-Pesa rows, so a reversed entry can be recorded again correctly).
  Why not use the M-Pesa code as the receipt (the first draft): the STK
  callback stores the provider's receipt inside the settlement transaction, and
  a unique clash there would roll the settlement back on every retry. The
  callback's receipt capture is savepoint-guarded so a display-only field can
  never undo a settlement. The one race left — the office records a code and
  the online confirmation for the same payment settles later — is flagged by
  Reconciliation (`duplicate_receipt`) for the treasurer to reverse the office
  row; nothing is auto-reversed.
- **Memberless office gifts**: a walk-in (name and/or phone) or anonymous gift
  (loose offering) has no member. Migration 202's checks allowed memberless rows
  only from the website; 216 widens them to `source IN ('website','admin')`,
  and an admin row is attributable through its office record (`office_channel`
  is always set). App rows stay strictly member-owned.
- **Currency**: a gift for a pledge or a department need must be in that
  pledge's or need's currency (422 `CURRENCY_MISMATCH`).
- **Dates**: an office gift's `created_at` and `settled_at` are the received
  date (12:00 EAT) so statements, pledge ledgers and reports put it in the right
  month; `received_on` ≤ today and ≥ today − 366 days.
- **Maker-checker**: expenses are recorded (no posting) and approved by a
  different person (posting on approval); SuperAdmin may approve their own.
- **Reversal only**: office gifts/manual claims can be reversed with a reason;
  provider payments (M-Pesa STK, card, PayPal) cannot be reversed here (provider
  refunds are out of scope). Approved expenses are voided by a reversing
  journal; recorded-but-unapproved expenses are simply voided.

### 2a. Dates and bases (so every page foots)
- Every ledger leg carries the **economic date** of what it records, in
  `ledger_entries.created_at`: an office gift at its received date (12:00
  EAT); a reversal at the date of the gift it corrects (a correction restates
  the day it corrects, so Sunday's takings stay right); expense legs and their
  void at `spent_on`; a transfer at `occurred_on`. When a row was actually
  entered lives on the owning row (`reversed_at`, `approved_at`, `voided_at`,
  `journals.created_at`) and in the audit log.
- Transaction-based views (Overview income, Transactions, Reports income,
  Statements, Pledges, budget income actuals, campaign raised) bucket by
  `transactions.created_at` in Africa/Nairobi — the basis the member
  statements already use — counting `succeeded` rows only.
- Ledger-based views (Ledger, Trial balance, fund movements, daily settlement)
  bucket by `ledger_entries.created_at` in Africa/Nairobi.
- Expense views bucket by `expenses.spent_on`.
- Online gifts post at settlement time while their transaction is dated at
  initiation; the two differ by seconds (M-Pesa) to minutes (card), so only a
  gift started before midnight at a month end and settled after it can sit in
  different months on the two kinds of view. All-time totals always agree.

## 3. Data model (migration 216, additive)
- `ledger_entries`: `transaction_id` DROP NOT NULL; ADD `journal_id uuid`
  REFERENCES journals; CHECK `num_nonnulls(transaction_id, journal_id) = 1`;
  index on journal_id; index on (account, created_at).
- `journals(journal_id, kind CHECK in (expense, expense_void, transfer), memo,
  occurred_on date, ref_id uuid, created_by, created_at)`.
- `transactions`: ADD `office_channel text CHECK in (onhand, bank, cheque,
  mpesa, other)`, `office_reference text`, `recorded_by uuid`, `reversed_at`,
  `reversed_by`, `reversal_reason text`; partial unique index on
  `receipt_code` WHERE receipt_code IS NOT NULL AND status <> 'failed' — check
  existing data for duplicates first; if any exist, enforce in code only and
  record that as a known limit.
- `receipt_counters(year int PK, next int)`.
- `expense_categories(category_id, code unique, name, is_active, sort)` seeded:
  staff-honoraria, utilities, rent, outreach-missions, worship-media,
  facilities-repairs, welfare-benevolence, events, administration, other.
- `expenses(expense_id, fund_id, category_id, payee, description, amount_minor
  > 0, currency, spent_on date, channel CHECK (onhand, bank, cheque, mpesa,
  other), reference, status CHECK (recorded, approved, void), recorded_by,
  recorded_at, approved_by, approved_at, voided_by, voided_at, void_reason,
  journal_id, void_journal_id)`.
- `fund_transfers(transfer_id, from_fund_id, to_fund_id (≠), amount_minor > 0,
  currency, occurred_on, memo, created_by, created_at, journal_id)`.
- `budgets(budget_id, year unique, name, status CHECK (draft, approved),
  created_by, approved_by, approved_at)`; `budget_lines(line_id, budget_id,
  kind CHECK (income, expense), fund_id nullable, category_id nullable,
  label, monthly_minor bigint[12] each ≥ 0)` — income lines need fund_id,
  expense lines need category_id. Budgets are KES.
- `funds`: ADD `description text`, `sort int default 0`. Funds are never
  deleted; `code` immutable; deactivate instead.
- Down migration drops the new objects and restores NOT NULL (only valid while
  no journal rows exist — documented).

## 4. API (all under `/v1/admin/finance`, JSON, snake_case)
Common: list endpoints take `from`, `to` (YYYY-MM-DD, EAT, inclusive), `cursor`,
`limit` (≤ 200, default 50) and return `{ data, next_cursor, totals }` where
`totals = [{ currency, amount_minor, count }]` is for the WHOLE filtered set.
CSV twins end in `.csv`, need `finance:export`, stream `text/csv; charset=utf-8`
with a header row and neutralise cells starting with `= + - @` (prefix `'`).

Reads (finance:view):
- `GET /overview?from&to` → per-currency income (period, month-to-date, year-to-
  date, same period last year), expenses (period, YTD), net, outstanding pledges
  (remaining this year), partners (count, behind), counts (processing, failed in
  period, pending claims, expenses awaiting approval, failing schedules), fund
  balances (top), 12-month series per currency `{month, income, expenses}`,
  `alerts: [{kind, count, link}]`.
- `GET /transactions?from&to&fund&status&channel&source&q&pledged(any|yes|no)
  &need(any|yes|no)&cursor&limit` (q matches receipt code, member name/phone,
  giver name, provider ref) → rows incl. member name, fund, channel, source,
  receipt, pledge title, need title, office fields, reversal fields.
  `GET /transactions.csv` same filters. `GET /transactions/:id` (existing,
  extended with office + reversal fields and all ledger legs).
- `GET /pledges?status&standing(on_track|behind)&shape&q&cursor` → the pledge
  register from the instalment ledger: member, title, shape, amount/target,
  paid this year, remaining this year, kept/due, next_due, overdue_since,
  status, pays_to; totals: pledged / paid / remaining per currency. `.csv`.
- `GET /funds` → every fund: code, name, name_sw, is_active, description,
  balance per currency (credits − debits on fund:<code>), income period/YTD,
  expenses YTD, transfers in/out YTD, last activity.
- `GET /ledger?account&kind(transaction|journal)&from&to&cursor` → postings with
  source (transaction receipt / journal kind + memo); `.csv`.
  `GET /trial-balance?from&to` → `[{account, debit_minor, credit_minor,
  balance_minor, currency}]` + per-currency totals and `balanced: bool`.
- `GET /reconciliation?from&to` → `settlement: [{day, channel, count,
  amount_minor, currency}]`, `exceptions: [{kind, transaction_id|journal_id,
  detail}]` (kinds: stale_processing (>30 min STK, >24 h card/PayPal),
  failed, succeeded_without_ledger, unbalanced_transaction,
  refunded_without_reversal, duplicate_receipt, unbalanced_journal),
  `integrity: {debits, credits, balanced}` per currency.
- `GET /reports/income?year&by(fund|channel|source)` → matrix rows × 12 months
  per currency + totals; `GET /reports/expenses?year&by(category|fund)`;
  `GET /reports/pledges?year` → per month pledged / paid / kept / missed /
  behind count; each with `.csv`.
- `GET /statements?year&q&cursor` → members who gave in the year: total per
  currency, gifts count, by fund, pledge paid; `.csv`.
  `GET /statements/:userId/giving.pdf?year` and `/partners.pdf?year` (the
  member PDFs, rendered for the office; 404 if nothing).
- `GET /expenses?status&fund&category&from&to&q&cursor` (+ `.csv`);
  `GET /expense-categories`; `GET /budgets` ; `GET /budgets/:id` (lines);
  `GET /budgets/:id/actuals` → per line 12-month budget vs actual (+ variance).
- `GET /audit?action_prefix&actor&from&to&cursor` (extends the existing filter
  to `pledge.`, `department.need`, `expense.`, `budget.`, `journal.`,
  `fund.`, `finance.`).
- `GET /settings` → providers (configured on/off, env names only), receipt
  counter (next), giving tiers, reminder policy (read-only text).
- Existing reads stay: `/summary`, `/trend` (fixed: per currency), `/config`,
  `/schedules` (+ `status`, `attention` filters), `/admin/campaigns*` (raised
  bounded by `ends_on`), `/admin/partners*`, `/admin/departments/needs`.
- `GET /v1/admin/permissions/catalog` → `{ modules: [...], capabilities: [...] }`
  (the server's own lists) for the role editors.

Writes (idempotent where money is created; every write audited `finance.*`):
- `POST /gifts` (finance:manage) `{ idempotency_key, user_id? | giver_name?,
  giver_phone?, anonymous?, fund, amount_minor, currency, channel, reference?,
  received_on, pledge_id?, need_id?, note? }` → the transaction (with receipt).
  reference required for mpesa (the M-Pesa code), cheque, bank — stored as
  `office_reference`; the receipt is always the office number `OR-…`.
  pledge_id must belong to user_id and be open; routing follows pledgeFundCode
  when pledged; pledge/need currency must match. Member gifts queue the normal
  receipt (outbox).
- `POST /transactions/:id/reverse` (finance:manage) `{ reason (5–300) }` — only
  provider `manual`, status succeeded; 422 otherwise.
- `POST /funds` / `PATCH /funds/:code` (finance:manage) — create (code slug
  `^[a-z][a-z0-9-]{1,39}$`), rename, describe, reorder, activate/deactivate.
- `POST /transfers` (finance:approve) `{ from_fund, to_fund, amount_minor,
  currency, occurred_on, memo }` → journal; fund balance may go negative only
  with `allow_negative: true` (warned in UI).
- `POST /expenses` (finance:manage) record; `PATCH /expenses/:id` while
  `recorded`; `POST /expenses/:id/approve` (finance:approve; approver ≠ recorder
  unless SuperAdmin) → journal; `POST /expenses/:id/void` (finance:manage)
  `{ reason }` → void (+ reversing journal if approved).
- `POST /expense-categories`, `PATCH /expense-categories/:id` (finance:manage).
- `POST /budgets` / `PATCH /budgets/:id` / `PUT /budgets/:id/lines` (manage,
  draft only) ; `POST /budgets/:id/approve` (finance:approve).
- Existing writes unchanged (claims confirm/reject, reminders, campaigns).

## 5. Pages (web + iPad show the same things)
- **Overview**: period picker (This month / Quarter / Year / custom); KPI tiles
  per currency (income, expenses, net, outstanding pledges, partners behind);
  12-month income vs expenses chart per currency; fund balances; alerts that
  deep-link (claims waiting, expenses to approve, failing schedules, stale
  processing, integrity issues).
- **Transactions**: filters bar (date range, fund, status, channel, source,
  pledged, need, search), totals strip for the filtered set, paginated table,
  CSV, detail drawer (ledger legs, receipt, member/pledge links, Reverse for
  manual entries), **Record a gift** drawer (member search or walk-in /
  anonymous, fund, amount, channel, reference, date, optional pledge/need).
- **Pledges**: register with standing chips, overdue since, kept/due, totals,
  CSV; row → member partner drawer.
- **Partners**: the existing page moved here; the drawer gains the partner's
  faithfulness strip + "overdue since" wording + Download partner statement.
- **Claims**: the claims queue as its own page (confirm/reject).
- **Recurring gifts**: schedules with needs-attention filter, run-rate totals.
- **Campaigns**: list + create/edit/go live/end + reach; raised vs goal.
- **Department needs**: approved/pending needs with raised vs target (links to
  Departments for approval).
- **Expenses**: list + record + approve (maker-checker) + void; totals; CSV.
- **Budgets**: year budget, lines editor (12 months), approve, budget vs actual
  with variance.
- **Funds**: balances, activity, create/edit/deactivate, transfer between funds.
- **Ledger**: Journal (postings) and Trial balance tabs; CSV.
- **Reconciliation**: Daily settlement, Exceptions, Integrity tabs.
- **Reports**: Income (by fund/channel/source), Expenses (by category/fund),
  Pledges; year picker; CSV.
- **Statements**: year-end giver list with totals + per-member PDFs.
- **Audit**: filterable finance audit trail.
- **Settings**: expense categories, providers status, receipt counter, tiers,
  roles help (which capability does what).

## 6. Permissions
- finance:view — every Finance page. finance:export — CSV. finance:manage —
  record/reverse gifts, funds, categories, record/void expenses, budgets (draft),
  campaigns, claims, reminders. finance:approve — approve expenses and budgets,
  post fund transfers. Admin/SuperAdmin bypass as today.
- Role editors (web Roles + Users, iPad Roles) render modules and capabilities
  from `/admin/permissions/catalog`, so saving never strips grants the editor
  did not show (today: manage/go/live/departments are silently removed).
- iPad `canManage` defaults to false while loading (web parity).

## 7. Verification — ten top-to-bottom cycles
Local stack (Postgres 16 + backend + portal dev + iPad simulator) seeded with a
realistic church year: 46+ partners, pledges in every state, online gifts in
KES and USD, office gifts (cash/bank/cheque/offline M-Pesa), reversals,
expenses in every state, a budget, transfers, campaigns, needs, claims,
failing schedules, stale processing, and deliberately broken rows for the
integrity checks. Each cycle walks every Finance page top to bottom on the web
AND the iPad, compares every number to the API/SQL truth, exercises every
action (and its permission denial with a finance:view-only user), records
findings, fixes, and re-runs the backend scenario suite. A cycle with zero
findings on both surfaces is required before merge; at most ten cycles.

## 8. Known limits (stated, not hidden)
- Finance is not congregation-scoped (transactions carry no congregation).
- Provider refunds (M-Pesa/card/PayPal) are not initiated from here.
- Expense attachments (receipt photos) are not stored yet.
- Budgets are KES only; USD income is reported beside, not against, budgets.
