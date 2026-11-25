import { createHash } from "node:crypto";

// One atomic reservation across the global and per-member daily budgets.
// Redis TIME keeps replicas on the same UTC day. A failed provider call still
// consumes the reservation: refunding an uncertain upstream charge can make
// the configured spend limit ineffective.
const RESERVE = `
local now = redis.call('TIME')
local day = math.floor(tonumber(now[1]) / 86400)
local amount = tonumber(ARGV[1])
local globalMax = tonumber(ARGV[2])
local userMax = tonumber(ARGV[3])
local function used(key)
  local values = redis.call('HMGET', key, 'day', 'used')
  if tonumber(values[1]) ~= day then return 0 end
  return tonumber(values[2]) or 0
end
local globalUsed = used(KEYS[1])
local userUsed = used(KEYS[2])
if globalUsed + amount > globalMax or userUsed + amount > userMax then return 0 end
redis.call('HSET', KEYS[1], 'day', day, 'used', globalUsed + amount)
redis.call('HSET', KEYS[2], 'day', day, 'used', userUsed + amount)
redis.call('EXPIRE', KEYS[1], 172800)
redis.call('EXPIRE', KEYS[2], 172800)
return 1`;

export interface NarrationQuotaRedis {
  eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown>;
}

export class RedisNarrationQuota {
  constructor(private readonly redis: NarrationQuotaRedis, private readonly globalDaily: number, private readonly userDaily: number) {
    if (!Number.isSafeInteger(globalDaily) || globalDaily < 1 || !Number.isSafeInteger(userDaily) || userDaily < 1) {
      throw new Error("Narration quota must have positive integer limits");
    }
  }

  async reserve(userId: string, characters: number): Promise<boolean> {
    if (!userId || !Number.isSafeInteger(characters) || characters < 1 || characters > 1200) {
      throw new Error("Invalid narration quota request");
    }
    const member = createHash("sha256").update(userId).digest("hex");
    const value = await this.redis.eval(RESERVE, 2, "narration:{quota}:global", `narration:{quota}:user:${member}`,
      String(characters), String(this.globalDaily), String(this.userDaily));
    if (value !== 0 && value !== 1) throw new Error("Invalid narration quota response");
    return value === 1;
  }
}
