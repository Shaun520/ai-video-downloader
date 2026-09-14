import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getAuthUser, unauthorized } from "@/lib/api-auth";
import { getSupabaseEnv } from "@saveany/db";
import { createAdminClient, adminCreateOrder, adminUpdateOrderSession } from "@saveany/db";

const PLANS: Record<string, { name: string; amount: number; currency: string }> = {
  monthly: { name: "AI 视频下载器 VIP 月度会员", amount: 990, currency: "cny" },
  yearly: { name: "AI 视频下载器 VIP 年度会员", amount: 9800, currency: "cny" },
};

const planPriceId: Record<string, string> = {
  monthly: process.env.STRIPE_PRICE_ID_MONTHLY || "",
  yearly: process.env.STRIPE_PRICE_ID_YEARLY || "",
};

function generateOrderNo(userId: string): string {
  const ts = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  const short = userId.replace(/-/g, "").slice(0, 8);
  const rand = Math.random().toString(16).slice(2, 10);
  return `SA${ts}${short}${rand}`;
}

/** POST /api/stripe/checkout — 创建 Stripe Checkout 会话（需登录） */
export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let body: { planType?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const planType = body.planType === "yearly" ? "yearly" : "monthly";
  const plan = PLANS[planType];
  const priceId = planPriceId[planType];

  const secretKey = process.env.STRIPE_SECRET_KEY || "";
  if (!secretKey || !priceId) {
    return NextResponse.json(
      { error: "支付服务暂未配置，请联系管理员开通后使用" },
      { status: 503 }
    );
  }

  const frontendUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3311";

  try {
    const env = getSupabaseEnv();
    const adminDb = createAdminClient(env);

    const orderNo = generateOrderNo(user.id);
    await adminCreateOrder(adminDb, {
      orderNo,
      userId: user.id,
      amount: plan.amount,
      currency: plan.currency,
      planType,
    });

    const stripe = new Stripe(secretKey);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${frontendUrl}?payment=success&order_no=${orderNo}`,
      cancel_url: `${frontendUrl}?payment=cancel&order_no=${orderNo}`,
      client_reference_id: user.id,
      customer_email: user.email ?? undefined,
      metadata: {
        order_no: orderNo,
        user_id: user.id,
        plan_type: planType,
      },
    });

    await adminUpdateOrderSession(adminDb, orderNo, session.id);

    return NextResponse.json({
      data: { checkoutUrl: session.url, orderNo, sessionId: session.id },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "创建支付会话失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}