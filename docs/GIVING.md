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
  hours later inside 08:00–20:00 EAT, never once the next cycle is due, with the
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
