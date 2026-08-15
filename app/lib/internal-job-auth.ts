import { createHash, timingSafeEqual } from "node:crypto";

export const INTERNAL_CRON_SECRET_ENV = "INTERNAL_CRON_SECRET";
export const MIN_INTERNAL_CRON_SECRET_LENGTH = 32;

export function authorizeInternalJob(request: Request, secret = process.env[INTERNAL_CRON_SECRET_ENV]) {
  if (!secret || secret.length < MIN_INTERNAL_CRON_SECRET_LENGTH) return false;
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = header.slice(7);
  if (supplied.length < MIN_INTERNAL_CRON_SECRET_LENGTH) return false;
  const expectedHash = createHash("sha256").update(secret).digest();
  const suppliedHash = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expectedHash, suppliedHash);
}
