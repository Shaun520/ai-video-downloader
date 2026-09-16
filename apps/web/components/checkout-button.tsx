"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SpinnerIcon } from "./icons";

/** 开通 VIP：跳转 Stripe Checkout */
export function CheckoutButton({ planType }: { planType: "monthly" | "yearly" }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planType }),
      });
      const json = (await res.json().catch(() => ({}))) as { data?: { checkoutUrl?: string }; error?: string };
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok || !json.data?.checkoutUrl) {
        setError(json.error || "创建支付会话失败");
        return;
      }
      window.location.href = json.data.checkoutUrl;
    } catch {
      setError("网络异常，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
      >
        {loading && <SpinnerIcon className="h-4 w-4" />}
        立即开通
      </button>
      {error && <p className="mt-2 text-center text-xs text-danger">{error}</p>}
    </div>
  );
}