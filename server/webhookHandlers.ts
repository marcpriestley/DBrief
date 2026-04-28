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
        let appStatus: string;
        if (status === 'active' || status === 'trialing') {
          appStatus = 'premium';
        } else if (status === 'canceled' || status === 'unpaid' || status === 'incomplete_expired') {
          appStatus = 'cancelled';
        } else {
          break;
        }
        const periodEnd = obj.current_period_end
          ? new Date(obj.current_period_end * 1000)
          : null;
        await db.update(users)
          .set({ subscriptionStatus: appStatus, ...(periodEnd ? { subscriptionCurrentPeriodEnd: periodEnd } : {}) })
          .where(eq(users.stripeCustomerId, customerId));
        console.log(`[Stripe] Subscription updated — customer ${customerId} -> ${appStatus}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const customerId = obj.customer;
        if (!customerId) break;
        await db.update(users)
          .set({ subscriptionStatus: 'cancelled' })
          .where(eq(users.stripeCustomerId, customerId));
        console.log(`[Stripe] Subscription deleted — customer ${customerId} -> cancelled`);
        break;
      }
    }
  }
}
