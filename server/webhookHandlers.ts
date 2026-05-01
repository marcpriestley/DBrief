import { getStripeSync } from './stripeClient';
import { db } from './db';
import { users } from '@shared/schema';
import { eq } from 'drizzle-orm';

// ── Webhook idempotency ───────────────────────────────────────────────────────
// Stripe guarantees at-least-once delivery — duplicate events are normal.
// We keep a sliding window of recently-processed event IDs so we don't write
// the same status change to the DB multiple times in quick succession.
// Entries expire after 10 minutes (Stripe retries happen within that window).
const processedEvents = new Map<string, number>();
const DEDUP_WINDOW_MS = 10 * 60 * 1000;

function markProcessed(eventId: string): boolean {
  const now = Date.now();
  // Evict stale entries to prevent unbounded growth
  for (const [id, ts] of processedEvents) {
    if (now - ts > DEDUP_WINDOW_MS) processedEvents.delete(id);
  }
  if (processedEvents.has(eventId)) return false; // already handled
  processedEvents.set(eventId, now);
  return true;
}

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);

    // Parse the event from the raw body (signature already verified above)
    // to update application-level subscription status
    try {
      const event = JSON.parse(payload.toString());
      await WebhookHandlers.handleAppEvent(event);
    } catch (err) {
      console.error('[Stripe] Failed to handle app event:', err);
    }
  }

  static async handleAppEvent(event: any): Promise<void> {
    // Deduplicate — Stripe may send the same event more than once
    if (!markProcessed(event.id)) {
      console.log(`[Stripe] Duplicate event ignored: ${event.id} (${event.type})`);
      return;
    }
    const obj = event.data?.object;
    if (!obj) return;

    switch (event.type) {
      case 'checkout.session.completed': {
        if (obj.mode !== 'subscription') break;
        const customerId = obj.customer as string | null;
        if (!customerId) break;

        // Primary match: by stripeCustomerId (for sessions created via our checkout endpoint).
        const primaryResult = await db.update(users)
          .set({ subscriptionStatus: 'premium', stripeCustomerId: customerId })
          .where(eq(users.stripeCustomerId, customerId))
          .returning({ id: users.id });

        if (primaryResult.length > 0) {
          console.log(`[Stripe] Checkout complete — customer ${customerId} -> premium (matched by customerId)`);
          break;
        }

        // Fallback: match by email — handles payment-link purchases where no prior
        // customer ID was stored. We also update stripeCustomerId so future syncs work.
        const customerEmail = obj.customer_details?.email as string | null;
        if (!customerEmail) {
          console.warn(`[Stripe] Checkout complete — customer ${customerId}: no user match and no email in event.`);
          break;
        }

        const emailResult = await db.update(users)
          .set({ subscriptionStatus: 'premium', stripeCustomerId: customerId })
          .where(eq(users.username, customerEmail))
          .returning({ id: users.id });

        if (emailResult.length > 0) {
          console.log(`[Stripe] Checkout complete — customer ${customerId} -> premium (matched by email ${customerEmail})`);
        } else {
          console.warn(`[Stripe] Checkout complete — customer ${customerId} (${customerEmail}): no matching user found.`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const customerId = obj.customer;
        const status = obj.status;
        if (!customerId) break;

        const periodEnd = obj.current_period_end
          ? new Date(obj.current_period_end * 1000)
          : null;

        let appStatus: string;
        if ((status === 'active' || status === 'trialing') && !obj.cancel_at_period_end) {
          // Fully active renewal — user keeps premium
          appStatus = 'premium';
        } else if ((status === 'active' || status === 'trialing') && obj.cancel_at_period_end) {
          // User cancelled but is still within the paid period — keep premium until it expires.
          // customer.subscription.deleted will fire when the period actually ends.
          appStatus = 'premium';
          console.log(`[Stripe] Subscription cancel_at_period_end — customer ${customerId} keeps premium until ${periodEnd}`);
        } else if (status === 'canceled' || status === 'unpaid' || status === 'incomplete_expired') {
          appStatus = 'free';
        } else {
          break;
        }

        await db.update(users)
          .set({ subscriptionStatus: appStatus, ...(periodEnd ? { subscriptionCurrentPeriodEnd: periodEnd } : {}) })
          .where(eq(users.stripeCustomerId, customerId));
        console.log(`[Stripe] Subscription updated — customer ${customerId} -> ${appStatus}`);
        break;
      }

      case 'customer.subscription.deleted': {
        // Subscription fully expired or was cancelled immediately.
        const customerId = obj.customer;
        if (!customerId) break;
        await db.update(users)
          .set({ subscriptionStatus: 'free', subscriptionCurrentPeriodEnd: null })
          .where(eq(users.stripeCustomerId, customerId));
        console.log(`[Stripe] Subscription deleted — customer ${customerId} -> free`);
        break;
      }
    }
  }
}
