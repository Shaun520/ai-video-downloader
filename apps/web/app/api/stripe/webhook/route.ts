import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";
import { getSupabaseEnv } from "@saveany/db";
import { createAdminClient, adminCompleteOrder } from "@saveany/db";

/** POST /api/stripe/webhook — Stripe 支付回调（幂等激活 VIP） */
export async function POST(req: NextRequest) {
  const secretKey = process.env.STRIPE_SECRET_KEY || "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
  if (!secretKey || !webhookSecret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 400 });
  }

  const payload = await req.text();
  const sig = req.headers.get("stripe-signature") || "";

  let event: Stripe.Event;
  try {
    const stripe = new Stripe(secretKey);
    event = stripe.webhooks.constructEvent(payload, sig, webhookSecret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.payment_status === "paid") {
      const paymentIntentId =
        typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? "";
      const env = getSupabaseEnv();
      const adminDb = createAdminClient(env);
      const order = await adminCompleteOrder(adminDb, session.id, paymentIntentId);
      if (order) {
        console.log(`[Stripe] 订单 ${order.order_no} 支付成功，VIP 已激活`);
      }
    }
  }

  return NextResponse.json({ received: true });
}