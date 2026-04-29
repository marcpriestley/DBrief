import { getStripeSync } from './stripeClient';
import { db } from './db';
import { users } from '@shared/schema';
import { eq } from 'drizzle-orm';

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
    const obj = event.data?.object;
    if (!obj) return;

    switch (event.type) {
      case 'checkout.session.completed': {
        if (obj.mode !== 'subscription') break;
        const customerId = obj.customer;
        const subscriptionId = obj.subscription;
        if (!customerId) break;
        await db.update(users)
          .set({ subscriptionStatus: 'premium' })
          .where(eq(users.stripeCustomerId, customerId));
        console.log(`[Stripe] Checkout complete — customer ${customerId} -> premium`);
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
