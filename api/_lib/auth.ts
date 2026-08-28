import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { HttpError, json, noStore } from "./http";

const COOKIE_NAME = "pi_webdesk_admin";
const SESSION_TTL_SECONDS = 12 * 60 * 60;

function configured(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) throw new HttpError(503, "Admin authentication is not configured");
  return value;
}

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function signature(payload: string): string {
  return createHmac("sha256", configured("SESSION_SECRET")).update(payload).digest("base64url");
}

function validSession(token: string | undefined): boolean {
  if (!token) return false;
  const [payload, supplied] = token.split(".");
  if (!payload || !supplied || supplied.length !== 43) return false;
  const expected = signature(payload);
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const expiry = Number.parseInt(Buffer.from(payload, "base64url").toString("utf8"), 10);
  return Number.isSafeInteger(expiry) && expiry > Math.floor(Date.now() / 1000);
}

function readCookie(request: Request): string | undefined {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return rest.join("=");
  }
  return undefined;
}

function secureCookie(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
}

function cookie(value: string, maxAge: number): string {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookie() ? "; Secure" : ""}`;
}

export function requireAdmin(request: Request): Response | null {
  try {
    if (validSession(readCookie(request))) {
      // SameSite=Strict is the main CSRF protection. When browsers send an
      // Origin header for a write, also require this application origin.
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
        const origin = request.headers.get("origin");
        if (origin && origin !== new URL(request.url).origin) return noStore(json({ error: "Cross-origin admin request blocked" }, { status: 403 }));
      }
      return null;
    }
  } catch (error) {
    if (error instanceof HttpError) return noStore(json({ error: error.message }, { status: error.status }));
    return noStore(json({ error: "Admin authentication is not configured" }, { status: 503 }));
  }
  return noStore(json({ error: "Admin authentication required" }, { status: 401 }));
}

export function login(password: string): Response {
  const expected = configured("ADMIN_PASSWORD");
  const actual = Buffer.from(password);
  const reference = Buffer.from(expected);
  const matches = actual.length === reference.length && timingSafeEqual(actual, reference);
  if (!matches) return noStore(json({ error: "Invalid admin password" }, { status: 401 }));
  const expiry = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = base64url(String(expiry));
  const token = `${payload}.${signature(payload)}`;
  return noStore(json({ ok: true, expiresAt: new Date(expiry * 1000).toISOString() }, { headers: { "Set-Cookie": cookie(token, SESSION_TTL_SECONDS) } }));
}

export function logout(): Response {
  return noStore(json({ ok: true }, { headers: { "Set-Cookie": cookie("", 0) } }));
}

export function sessionStatus(request: Request): Response {
  try {
    return noStore(json({ authenticated: validSession(readCookie(request)) }));
  } catch (error) {
    if (error instanceof HttpError) return noStore(json({ error: error.message }, { status: error.status }));
    return noStore(json({ authenticated: false }));
  }
}
