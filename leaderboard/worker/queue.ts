/**
 * Queue consumer: processes per-trader sync messages.
 *
 * Each message triggers an Alpaca data sync for one trader via their SyncerDO.
 * On success, the message re-enqueues itself with a tier-appropriate delay,
 * creating a perpetual sync loop per trader.
 */

import { tierDelaySeconds, type SyncTier } from "./tiers";
import { decryptToken } from "./crypto";
import { invalidateTraderCache } from "./cache";
import type { SyncMessage, TraderWithTokenRow } from "./types";

export async function processSyncMessage(
  message: Message<SyncMessage>,
  env: Env
): Promise<void> {
  const { traderId } = message.body;

  // 1. Look up trader + token from D1
  const row = await env.DB.prepare(
    `SELECT t.id, t.username, t.sync_tier, t.is_active,
            ot.access_token_encrypted
     FROM traders t
     LEFT JOIN oauth_tokens ot ON ot.trader_id = t.id
     WHERE t.id = ?1`
  ).bind(traderId).first<TraderWithTokenRow>();

  // Inactive or missing token → ack and let message die
  if (!row || !row.is_active || !row.access_token_encrypted) {
    message.ack();
    return;
  }

  // 2. Decrypt token
  let token: string;
  try {
    token = await decryptToken(
      row.access_token_encrypted,
      env.ENCRYPTION_KEY,
      traderId
    );
  } catch {
    console.error(`[queue] Failed to decrypt token for trader ${traderId}`);
    message.ack();
    return;
  }

  // 3. Call SyncerDO.sync()
  const doId = env.SYNCER.idFromName(traderId);
  const stub = env.SYNCER.get(doId);
  const result = await stub.sync(traderId, token);

  const tier = row.sync_tier as SyncTier;

  if (result.success) {
    // 4a. Success: invalidate trader cache, re-enqueue with tier delay
    message.ack();
    await invalidateTraderCache(env, row.username);
    await env.SYNC_QUEUE.send(
      { traderId } satisfies SyncMessage,
      { delaySeconds: tierDelaySeconds(tier) }
    );
  } else if (result.alpacaStatus === 401) {
    // 4b. Token revoked: delete token and let message die (no re-enqueue)
    message.ack();
    await env.DB.prepare(`DELETE FROM oauth_tokens WHERE trader_id = ?1`).bind(traderId).run();
    console.log(`[queue] Token revoked for trader ${traderId}, removed oauth_token`);
  } else {
    // 4c. Transient failure: retry with exponential backoff, capped at 6h.
    const backoffDelay = Math.min(
      tierDelaySeconds(tier) * Math.pow(2, message.attempts - 1),
      21600
    );
    message.retry({ delaySeconds: backoffDelay });
  }
}
