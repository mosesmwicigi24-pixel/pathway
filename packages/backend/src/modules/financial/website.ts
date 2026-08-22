// Website giving — the Give button on nuruplace.org (migration 202).
//
// Shape: the visitor's browser posts to the website, the website signs the
// payload and forwards it here, we send an M-Pesa STK push to the number they
// typed and write a memberless `processing` row. Settlement happens where it
// always has — on the verified mobile-money callback — so a website gift is an
// ordinary line in the same double-entry ledger.
//
// The reason this is a `/webhooks/*` route rather than a public POST: app.ts
// skips JSON parsing for that prefix, so the handler sees the exact bytes the
// signature was computed over. Parsing and re-serialising changes key order and
// whitespace, and every signature fails.
//
// ---------------------------------------------------------------------------
// The thing this endpoint is, if you build it carelessly
// ---------------------------------------------------------------------------
// "Type a phone number, press Give" means "type ANY phone number and make that
// phone ring". Unthrottled, a donate button is a harassment tool: no account
// needed, no cost to the sender, and the victim's phone shows a payment request
// from a real church. So there are two buckets, and the important one is keyed
// on the DESTINATION number rather than on the sender — a sender behind CGNAT
// is indistinguishable from a whole congregation, but the number being rung is
// unambiguous and is the thing actually being abused.
//
// Both buckets are consumed AFTER the signature verifies. Consuming first would
// let anyone with no secret at all drain a real giver's allowance by replaying
// forged requests at their number — trading a harassment vector for a
// denial-of-service one.
import express, { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { handler, parseBody } from "../../http/http.js";
import { ApiError } from "../../http/errors.js";
import type { RateLimitStore } from "../../http/rateLimit.js";
import { FinancialService } from "./service.js";
import { buildPaymentGateway, type PaymentGateway } from "./gateway.js";
import { buildMobileMoneyProviders, toMsisdn, type MobileMoneyProviders } from "./providers.js";
import { verifyWebsiteSignature } from "../../http/websiteSignature.js";

/**
 * Three STK pushes to one number, then one more every ten minutes.
 *
 * A real giver who fat-fingers the amount and retries twice is unaffected. A
 * harasser gets three prompts — annoying, not a weapon — and then a rate that
 * makes it pointless. Ten minutes is long enough to be useless to an attacker
 * and short enough that a giver who walked away and came back can still give.
 */
const PHONE_BURST = 3;
const PHONE_REFILL_PER_SEC = 1 / 600;

/**
 * Per originating IP, as the website reports it.
 *
 * Looser than the phone bucket on purpose: church Wi-Fi and Safaricom's CGNAT
 * put hundreds of real people behind one address, and an offering announced
 * from the front means many of them give in the same two minutes. This is a
 * coarse abuse guard; the phone bucket is the one protecting a person.
 */
const IP_BURST = 10;
const IP_REFILL_PER_SEC = 1 / 60;

/**
 * Everything arriving through the website relay, together.
 *
 * `client_ip` is a value the website puts in the body, so a compromised or
 * buggy website could spread an attack across fabricated addresses and never
 * touch the IP bucket. This one cannot be evaded that way: it is keyed on
 * nothing but the fact that the request came from the website at all. Sized so
 * a busy Sunday passes and a script does not.
 */
const RELAY_BURST = 60;
const RELAY_REFILL_PER_SEC = 1 / 10;

/**
 * Polling the thank-you screen, per transaction.
 *
 * 90 covers a page asking every 2.5 seconds for the ~3 minutes an STK push can
 * take, with room to spare; the slow refill means the same gift cannot be
 * polled all day. Nothing here rings a phone or moves money, so it can be this
 * loose without being a lever on anybody.
 */
const STATUS_BURST = 90;
const STATUS_REFILL_PER_SEC = 1 / 20;

export function registerWebsiteGiving(
  ctx: AppContext,
  rl: RateLimitStore,
  gatewayOverride?: PaymentGateway,
  mobileMoneyOverride?: MobileMoneyProviders,
): Router {
  const svc = new FinancialService(
    ctx.db.primary,
    gatewayOverride ?? buildPaymentGateway(ctx.env),
    mobileMoneyOverride ?? buildMobileMoneyProviders(ctx.env),
  );

  // A FRESH router per call, deliberately unlike the module-level singleton
  // `financialRouter` next door. With a singleton, every createApp() registers
  // these handlers onto the same object and the FIRST registration wins — so a
  // second app built with a different env is served by the first app's
  // closures, which still hold the first env. A test asserting "refuses when no
  // secret is configured" then runs through a handler that has one and reports
  // success. The same shape would let a rotated secret keep answering with the
  // old one for the lifetime of the process.
  const r = Router();

  /**
   * What a visitor may give to, and how they may pay.
   *
   * Public and unauthenticated — it is the content of a page anyone can load.
   * It carries fund codes and display names only: no balances, no totals, no
   * hint of what the church holds. `providers` reports what is actually wired
   * so the website can render the M-Pesa form or an honest "not available yet"
   * rather than a button that fails after the visitor has typed their number.
   */
  r.get(
    "/giving/funds",
    handler(async (_req, res) => {
      const e = ctx.env;
      const mpesaReady =
        Boolean(e.MPESA_CONSUMER_KEY && e.MPESA_PASSKEY && e.MPESA_SHORTCODE) || Boolean(e.MPESA_CALLBACK_SECRET);
      res.json({
        funds: await svc.publicFunds(),
        currency: "KES",
        min_minor: FinancialService.WEBSITE_MIN_MINOR,
        max_minor: FinancialService.WEBSITE_MAX_MINOR,
        providers: [
          { key: "mpesa", label: "M-Pesa", enabled: mpesaReady },
          { key: "airtel", label: "Airtel Money", enabled: Boolean(e.AIRTEL_CALLBACK_SECRET) },
        ],
      });
    }),
  );

  r.post(
    "/webhooks/website-giving",
    express.raw({ type: "*/*", limit: "64kb" }),
    handler(async (req, res) => {
      const secret = ctx.env.WEBSITE_GIVING_WEBHOOK_SECRET;
      if (!secret) {
        // Fail closed. An unsigned endpoint that initiates STK pushes is worse
        // than a Give button that says "please use the app today", because the
        // failure lands on people who never visited the site.
        throw new ApiError("UPSTREAM_UNAVAILABLE", "Website giving is not configured");
      }

      const rawBody: string = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : JSON.stringify(req.body ?? {});
      verifyWebsiteSignature(rawBody, req.header("x-nuruplace-signature"), secret);

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        throw new ApiError("VALIDATION_FAILED", "Body is not valid JSON");
      }
      const input = parseBody(FinancialService.WebsiteGift, parsed);

      // Order matters: relay first (cheapest, unavoidable), then the giver's
      // network, then the number about to ring. Each `consume` spends a token,
      // so checking the phone last means a request already refused for another
      // reason has not eaten the victim's allowance.
      await consume(rl, "webgive:relay", "all", RELAY_BURST, RELAY_REFILL_PER_SEC);
      await consume(rl, "webgive:ip", input.client_ip ?? req.ip ?? "unknown", IP_BURST, IP_REFILL_PER_SEC);
      // Normalised, so 0722…, +254722… and 254722… are ONE bucket rather than
      // three ways to ring the same handset.
      await consume(rl, "webgive:phone", toMsisdn(input.phone_number), PHONE_BURST, PHONE_REFILL_PER_SEC, res);

      res.status(201).json(await svc.createWebsiteGivingIntent(input));
    }),
  );

  /**
   * Did that gift land?
   *
   * The website polls this while the giver is at their handset, so the page can
   * stop saying "check your phone" and say thank you instead. Signed like the
   * intake — same secret, same scheme — because it reads from the ledger, and
   * an open version would let anyone holding a transaction id learn what was
   * given.
   *
   * Its own bucket, keyed on the transaction and far looser than the giving
   * one: a page polling every few seconds for two minutes is the INTENDED
   * behaviour here, and reusing the STK bucket would throttle the thank-you
   * screen of the very person who just gave. Bounded all the same, so a
   * signature-holder cannot poll one gift indefinitely.
   */
  r.post(
    "/webhooks/website-giving/status",
    express.raw({ type: "*/*", limit: "8kb" }),
    handler(async (req, res) => {
      const secret = ctx.env.WEBSITE_GIVING_WEBHOOK_SECRET;
      if (!secret) throw new ApiError("UPSTREAM_UNAVAILABLE", "Website giving is not configured");

      const rawBody: string = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : JSON.stringify(req.body ?? {});
      verifyWebsiteSignature(rawBody, req.header("x-nuruplace-signature"), secret);

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        throw new ApiError("VALIDATION_FAILED", "Body is not valid JSON");
      }
      // .uuid() rather than a bare string: a malformed id would otherwise reach
      // Postgres and come back as a 500 instead of a readable 400.
      const input = parseBody(z.object({ transaction_id: z.string().uuid() }), parsed);

      await consume(rl, "webgive:status", input.transaction_id, STATUS_BURST, STATUS_REFILL_PER_SEC);

      const gift = await svc.websiteGiftStatus(input.transaction_id);
      if (!gift) throw new ApiError("NOT_FOUND", "No website gift with that id");
      res.json(gift);
    }),
  );

  return r;
}

/**
 * Spend one token or refuse.
 *
 * `Retry-After` is set only for the bucket we are willing to name — the phone
 * one, where telling a genuine giver "try again in nine minutes" is useful. For
 * the relay and IP buckets the response is a bare 429: a probe should not be
 * told how long to sleep before its next attempt.
 */
async function consume(
  store: RateLimitStore,
  name: string,
  key: string,
  capacity: number,
  refillPerSec: number,
  res?: express.Response,
): Promise<void> {
  const result = await store.consume(`${name}:${key}`, capacity, refillPerSec);
  if (result.allowed) return;
  if (res) res.setHeader("Retry-After", String(result.retryAfterSec));
  throw new ApiError("RATE_LIMITED", "Too many giving requests for this number; please wait a moment");
}
