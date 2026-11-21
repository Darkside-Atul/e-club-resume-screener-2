import "server-only";

export function authorizedDomain() {
  return (process.env.AUTHORIZED_EMAIL_DOMAIN || "ashoka.edu.in").trim().toLowerCase();
}

export function allowedEmail(email: string | undefined) {
  const parts = email?.toLowerCase().split("@");
  return !!parts?.[0] && parts.length === 2 && parts[1] === authorizedDomain();
}

export function demoEnabled() {
  return process.env.DEMO_MODE === "true";
}

export function publicConfig() {
  if (demoEnabled()) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

export function appUrl() {
  return new URL(process.env.APP_URL || "http://localhost:3000").origin;
}

function integerSetting(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function resumeLimitBytes() {
  return integerSetting(process.env.MAX_RESUME_MB, 10, 1, 25) * 1024 * 1024;
}

export function retentionDays() {
  return integerSetting(process.env.APPLICATION_RETENTION_DAYS, 180, 1, 3650);
}
