// Shared invite-token minting (docs/READING_SOCIAL_PLAN.md §2.2). Plaintext,
// URL-safe, 43 chars (32 random bytes, base64url, no padding) — matches
// shared_plan_invites.token VARCHAR(43). See migration 175's header comment
// for why this is plaintext, not hashed like password_resets.token_hash.
import { randomBytes } from "node:crypto";
import { maybeOne, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";

export async function mintInviteToken(c: Queryable): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = randomBytes(32).toString("base64url");
    const clash = await maybeOne(c, `SELECT 1 FROM shared_plan_invites WHERE token = $1`, [token]);
    if (!clash) return token;
  }
  throw new ApiError("INTERNAL", "Could not mint a unique invite token");
}
