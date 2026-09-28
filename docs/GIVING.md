# Giving — how money comes in, and the rules that keep it right

Owner request 2026-09-28: work directly on the existing Giving module (member
apps, backend, office) through ten improvement cycles, each with at least ten
realistic scenarios run end to end, diagnosing root causes and retesting. This
document is the contract the backend, the iOS and Android member apps and the
office surfaces build to; `docs/PARTNERS_PROGRAMME.md` (pledges, reminders,
statements) and `docs/FINANCE_ERP.md` (the books) remain the specs for their
parts. Section numbers are cited from code.

## 1. Rails (GET /giving/methods)

| Rail | Currency | Limits | Recurring | Prompts a phone | Live when |
|---|---|---|---|---|---|
| M-Pesa (Daraja STK push) | KES, whole shillings | KSh 1 – 250,000 | yes | yes | Daraja keys set |
| Airtel Money | KES | KSh 1 – 150,000 | yes | yes | never in production (no real integration; the HMAC fake is test/dev only) |
| PayPal | **USD** — the amount IS dollars | USD 1 – 10,000 | no | no | PayPal keys set |
| Card (Stripe) | any | 1 – 1,000,000 major units | no | no | `CARD_GIVING_ENABLED=true` (default off in production: no app can confirm a card payment yet) |

The apps draw their method list from `GET /giving/methods` and never offer a
disabled rail as if it could take money. Every gift is checked before any phone
rings: rail live (`METHOD_UNAVAILABLE`), its currency (`METHOD_CURRENCY`), its
limits and whole shillings (`AMOUNT_OUT_OF_RANGE`), a real Kenyan mobile number
for mobile money (`PHONE_REQUIRED`). One prompt per member at a time: a prompt
from the last 90 seconds still unanswered refuses a second (`GIFT_IN_PROGRESS`,
details.transaction_id); a replay with the same idempotency key returns the
existing transaction.

## 2. Settlement truth (Cycle 1)

- Daraja signs nothing and its callback URL is public. A callback is only a
  **hint**: an unknown CheckoutRequestID is ignored (one indexed read, no
  provider call, no write); otherwise the server asks Safaricom (STK Push
  Query, at most every 10 s per prompt) and applies **Safaricom's answer**. A
  forged "paid" moves nothing. An unsigned caller always gets `{ received: true }`.
- The **mobile-money sweeper** (worker, every minute) asks about prompts still
  processing after 90 s (each at most once a minute, 25 per run) and closes any
  unanswered after 48 h as `no_answer`.
- Every failure records **why**: `failure_code` (our word) + `failure_detail`
  (Safaricom's code and text). Members read `failure { code, reason, hint,
  retryable }` on history and receipts — one table (`giftFailure.ts`):

| M-Pesa ResultCode | failure_code | retryable |
|---|---|---|
| 1032 | cancelled | no |
| 1037 | unreachable | yes |
| 1019 | expired | yes |
| 1 | insufficient_funds | no |
| 2001 | wrong_pin | no |
| 1001 | busy | yes |
| 1025, 9999, 26, 17 | system | yes |
| other | declined | no |
| (none in 48 h) | no_answer | no |
| (no usable number at send) | no_phone | no |

- Production never builds the HMAC fakes (a stray `*_CALLBACK_SECRET` used to
  switch on an "Airtel" that prompted no phone).

## 3. Recurring gifts (Cycle 1)

- Mobile money only; KES; whole shillings; a real number (the schedule's own
  `phone_number` when the member chose one, else the profile number, followed if
  it changes). The same gift twice within ten minutes is ONE schedule; the same
  gift while one exists is `SCHEDULE_EXISTS`.
- **Sending a prompt is not collecting a gift.** The outcome comes back from
  M-Pesa and is fed to the schedule: success clears the strikes; a failure is a
  strike with its reason. If the member never had a chance to answer
  (unreachable, expired, busy, system) the cycle is tried **once** more, two
  hours later inside prompt hours (07:00–21:00 Nairobi), never once the next cycle is due, with the
  key `sched:{id}:{cycle}:r{n}` after proving no attempt of the cycle succeeded
  or is still waiting. The member's own answer (cancelled, wrong PIN, not enough
  money) is never re-sent. Three strikes pause the schedule; the member is told
  on the first strike and on the pause, with the reason.
- One prompt per phone at a time: a phone already prompted in the run, or with a
  prompt from the last two minutes still waiting, is deferred three minutes (not
  a strike). A replay of a prompt already sent for the cycle is not deferred.
- A Safaricom outage or a missing configuration while prompting is **ours**: no
  strike, no notice, back in an hour. A number M-Pesa refuses to prompt is the
  gift's problem (`no_phone`), one strike, the member told.

## 4. Cycle log

The scenario suites are `packages/backend/test/giving-cycle-NN.test.ts` (each
`it` is one scenario) plus the apps' unit tests; the running log of findings,
fixes and results is kept in the PR descriptions.

## 5. Honest money on paper and on the calendar (Cycle 2)

- **Statements and receipts** date every gift on the Nairobi calendar and clock
  (a gift at 00:30 on 1 January is 1 January, 12:30 AM — it used to print under
  31 December in UTC while counting in the new year). Every amount is printed in
  its own currency; totals are per currency ("KSh 3,500 + USD 20.00"), never one
  sum. `GET /giving/statements` gains `totals[]` per currency, and `by_fund` /
  `by_pledge` rows carry their currency; `total_minor`/`currency` are the first
  entry (shillings first).
- **A receipt tells the truth about its gift**: only settled money is "Received
  with thanks … Official receipt". A gift still clearing says "Waiting for the
  payment to clear"; a failed one says "This gift did not go through", gives the
  reason and the hint, and reads "Not a receipt: no money has been received for
  this gift" (a GIFT RECORD, not a GIVING RECEIPT).
- **Cover the fee**: the intent may carry `cover_fee_minor` (≤ half the gift;
  whole shillings for M-Pesa). `amount_minor` stays what was charged and booked
  (the ledger is unchanged); history and detail carry `fee_cover_minor`, and the
  receipt reads "Gift … Fee cover … covered by you … Total …". It used to print
  "Fee: KSh 0" whatever the member added.
- **Monthly gifts keep their day** (`anchor_day`, migration 219, backfilled from
  the day each was set up, Nairobi): the next cycle is computed on the Nairobi
  calendar, clamped to short months (31 Jan → 28/29 Feb → 31 Mar), at the same
  Nairobi time. The old UTC arithmetic sent a gift on the 31st to the 3rd and let
  one set up at 01:00 on the 1st creep back a day a month.
- **Prompts keep to 07:00–21:00 Nairobi** (the platform's quiet hours): a first
  prompt that would fall at night is moved to 20:00 (or 07:00) on the same day,
  so a weekly gift keeps its weekday; a retry that would fall at night waits for
  07:00.
- A member can ask for one year's giving statement PDF (`?year=`).

## 6. Recovery (Cycle 3)

- **Try again** (`POST /giving/transactions/{id}/retry`): a new gift carrying
  everything the failed one did — fund, amount, currency, method, the pledge or
  need, the name, the fee cover — so a retry can never quietly lose its pledge.
  Only the giver's own failed gift (404 / 422 otherwise); the pledge or need is
  checked afresh (a pledge cancelled since is refused), every Cycle 1 check runs
  again, and a retry while one is waiting is `GIFT_IN_PROGRESS`.
- **The verdict while the member waits**: the app polls
  `GET /giving/transactions/{id}`; once a prompt is 20 s old without a verdict,
  reading it asks the provider (at most every 10 s per prompt) and applies the
  answer as a callback would. The sweeper remains the safety net.
- **A failure they could not see reaches them**: a member's own gift that failed
  where they could not see it — the prompt never reached them, or no answer came
  — and at least 45 s after they started it, sends `giving_gift_failed` with the
  reason and the hint. Their own decline (cancelled, wrong PIN, not enough money)
  is never re-announced; a recurring charge speaks through its schedule notice;
  a stranger's website gift has nobody to notify.
- **Nothing stays "processing" for ever**: PayPal orders nobody approved and card
  intents nobody confirmed are closed after 48 h as `no_answer`; if a provider
  later reports one paid, it still books (money that arrived always wins).
- **The office sees why**: the transactions register and drawer carry `failure`
  (the member's words) and `failure_detail` (M-Pesa's code and text), and
  `fee_cover_minor`; the CSV appends `failure_reason, provider_detail, fee_cover`.
