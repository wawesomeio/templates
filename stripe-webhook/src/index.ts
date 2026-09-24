import Stripe from "stripe";

const cryptoProvider = Stripe.createSubtleCryptoProvider();

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "This endpoint accepts POST from Stripe only." }, { status: 405 });
    }

    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      console.error("STRIPE_WEBHOOK_SECRET is not set. Run: wawesome env set STRIPE_WEBHOOK_SECRET whsec_... --secret");
      return Response.json({ error: "Webhook endpoint is not configured." }, { status: 500 });
    }

    // Stripe signs the raw bytes, so the body must not be parsed before it is verified.
    const payload = await request.text();

    let event: Stripe.Event;
    try {
      event = await Stripe.webhooks.constructEventAsync(
        payload,
        request.headers.get("stripe-signature") ?? "",
        secret,
        undefined,
        cryptoProvider,
      );
    } catch (error) {
      console.warn(`Rejected webhook: ${error instanceof Error ? error.message : String(error)}`);
      return Response.json({ error: "Signature verification failed." }, { status: 400 });
    }

    console.log(`Verified ${event.type} (${event.id})`);
    await handleEvent(event);
    return Response.json({ received: true });
  },
};

// Stripe delivers at least once and in no set order: skip an event.id you have already applied.
async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      console.log(`Checkout completed: ${session.id} for ${session.customer_details?.email ?? "an unknown customer"}`);
      break;
    }

    case "payment_intent.succeeded": {
      const paymentIntent = event.data.object;
      console.log(`Payment succeeded: ${formatAmount(paymentIntent.amount_received, paymentIntent.currency)}`);
      break;
    }

    case "payment_intent.payment_failed": {
      const paymentIntent = event.data.object;
      console.warn(`Payment failed: ${paymentIntent.id}: ${paymentIntent.last_payment_error?.message ?? "no reason given"}`);
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      console.log(`Subscription cancelled: ${subscription.id} for customer ${String(subscription.customer)}`);
      break;
    }

    default:
      console.log(`Ignoring unhandled event type: ${event.type}`);
  }
}

function formatAmount(amountInMinorUnits: number, currency: string): string {
  return `${(amountInMinorUnits / 100).toFixed(2)} ${currency.toUpperCase()}`;
}
