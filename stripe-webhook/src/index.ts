import type Stripe from "stripe";
import { verifyStripeSignature } from "./stripe-signature.js";

/**
 * A Stripe webhook endpoint.
 *
 * Every request is treated as hostile until its signature checks out: the URL is
 * public, and a forged `payment_intent.succeeded` is worth real money to whoever
 * can get one past you. Only after verification does the payload become an
 * `Event` worth acting on.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "This endpoint accepts POST from Stripe only." }, { status: 405 });
    }

    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      // Without the secret nothing can be verified, so accepting the request
      // would mean acting on unauthenticated input. Refuse loudly instead.
      console.error("STRIPE_WEBHOOK_SECRET is not set — run: wawesome env set STRIPE_WEBHOOK_SECRET whsec_... --secret");
      return Response.json({ error: "Webhook endpoint is not configured." }, { status: 500 });
    }

    // The signature covers the bytes exactly as Stripe sent them, so the body is
    // read once, as text, and never parsed before it has been verified.
    const payload = await request.text();

    const verification = await verifyStripeSignature({
      payload,
      header: request.headers.get("stripe-signature"),
      secret,
    });

    if (!verification.ok) {
      console.warn(`Rejected webhook: ${verification.reason} — ${verification.message}`);
      return Response.json({ error: "Signature verification failed." }, { status: 400 });
    }

    const event = JSON.parse(payload) as Stripe.Event;
    console.log(`Verified ${event.type} (${event.id})`);

    await handleEvent(event);

    // Stripe retries anything that is not a 2xx, so acknowledge as soon as the
    // event is safely recorded rather than after slow downstream work.
    return Response.json({ received: true });
  },
};

/**
 * Where your business logic goes.
 *
 * Stripe delivers at-least-once and does not guarantee order, so treat
 * `event.id` as an idempotency key: record it, and skip anything you have
 * already applied.
 */
async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      console.log(`Checkout completed: ${session.id} for ${session.customer_details?.email ?? "an unknown customer"}`);
      // e.g. grant access to what the customer just paid for.
      break;
    }

    case "payment_intent.succeeded": {
      const paymentIntent = event.data.object;
      console.log(`Payment succeeded: ${formatAmount(paymentIntent.amount_received, paymentIntent.currency)}`);
      break;
    }

    case "payment_intent.payment_failed": {
      const paymentIntent = event.data.object;
      console.warn(`Payment failed: ${paymentIntent.id} — ${paymentIntent.last_payment_error?.message ?? "no reason given"}`);
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      console.log(`Subscription cancelled: ${subscription.id} for customer ${String(subscription.customer)}`);
      // e.g. revoke access at the end of the paid period.
      break;
    }

    default:
      // Stripe sends whatever the endpoint is subscribed to, and adds new event
      // types over time. Ignoring the rest keeps this endpoint from 500-ing on
      // an event it was never written for.
      console.log(`Ignoring unhandled event type: ${event.type}`);
  }
}

function formatAmount(amountInMinorUnits: number, currency: string): string {
  return `${(amountInMinorUnits / 100).toFixed(2)} ${currency.toUpperCase()}`;
}
