/** 阶段 3 数据层冒烟：连接 Supabase 验证 quota 扣减 + RLS 读写 */
import { createClient } from "@supabase/supabase-js";
import { checkAndIncrementSummary } from "@saveany/db";

const url = "https://zwadisymylqberhsftmp.supabase.co";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TEST_EMAIL = "stage3-test@example.com";

// 1. 找到测试用户
const { data: users } = await supabase
  .from("users")
  .select("*")
  .eq("email", TEST_EMAIL);
const user = users?.[0];
if (!user) {
  console.error("❌ 未找到测试用户");
  process.exit(1);
}
console.log("✓ 测试用户:", user.id);

// 2. 连调 4 次 quota（免费上限 3，第 4 次应被拒绝）
let results = [];
for (let i = 0; i < 4; i++) {
  const r = await checkAndIncrementSummary(supabase, user.id);
  results.push(r);
  console.log(`  第${i + 1}次: allowed=${r.allowed} remaining=${r.remaining}${r.message ? " | " + r.message : ""}`);
}

const okCount = results.filter((r) => r.allowed).length;
if (okCount !== 3) {
  console.error(`❌ 免费额度应允许 3 次，实际 ${okCount} 次`);
  process.exit(1);
}
if (results[3] && results[3].allowed) {
  console.error("❌ 第 4 次应被拒绝");
  process.exit(1);
}

// 3. 验证数据库中已扣到 3
const { data: after } = await supabase
  .from("users")
  .select("daily_summary_count, last_summary_date")
  .eq("id", user.id)
  .single();
if (after.daily_summary_count !== 3) {
  console.error(`❌ 期望 daily_summary_count=3，实际 ${after.daily_summary_count}`);
  process.exit(1);
}
console.log(`✓ daily_summary_count=${after.daily_summary_count}, date=${after.last_summary_date}`);

// 4. 重置回 0（避免影响后续手工测试）
const { error: resetErr } = await supabase
  .from("users")
  .update({ daily_summary_count: 0, last_summary_date: null, updated_at: new Date().toISOString() })
  .eq("id", user.id);
if (resetErr) {
  console.error("❌ 重置失败:", resetErr.message);
  process.exit(1);
}
console.log("✓ 已重置为 0");

console.log("\n阶段 3 数据层冒烟全部通过 ✅");
process.exit(0);