/** Admin 单密码登录会话（HMAC 签名 Cookie，服务端校验）
 *  使用 Web Crypto API（Edge 与 Node 运行时均可用）。 */
export const ADMIN_SESSION_COOKIE = "saveany_admin_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 天

const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function sessionSecret(): string {
  return process.env.ADMIN_PASSWORD || "";
}

export async function signSessionToken(): Promise<string> {
  const secret = sessionSecret();
  if (!secret) return "";
  const digest = await hmacHex(secret, "saveany-admin-session-v1");
  return `v1.${digest}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const expected = await signSessionToken();
  if (!expected) return false;
  return constantTimeEqual(token, expected);
}

export function checkAdminPassword(input: string): boolean {
  const secret = sessionSecret();
  if (!secret) return false;
  return input === secret;
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
}