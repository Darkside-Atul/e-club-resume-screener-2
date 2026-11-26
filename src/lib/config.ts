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
  const newUrl =
    process.env.NEXT_PUBLIC_SUPABASE_NEW_SUPABASE_URL_2 ||
    process.env.SUPABASE_NEW_SUPABASE_URL_2 ||
    process.env.NEXT_PUBLIC_SUPABASE_NEW_SUPABASE_URL ||
    process.env.SUPABASE_NEW_SUPABASE_URL;
  const url = newUrl ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_RESUME_MRTS_SUPABASE_URL ||
    process.env.RESUME_MRTS_SUPABASE_URL ||
    process.env.RESUME_MRTS_SUPABASE_URL_2 ||
    process.env.SUPABASE_URL_2 ||
    process.env.SUPABASE_URL_3;
  const newKey =
    process.env.NEXT_PUBLIC_SUPABASE_NEW_SUPABASE_PUBLISHABLE_KEY_2 ||
    process.env.NEXT_PUBLIC_SUPABASE_NEW_SUPABASE_ANON_KEY_2 ||
    process.env.SUPABASE_NEW_SUPABASE_PUBLISHABLE_KEY_2 ||
    process.env.SUPABASE_NEW_SUPABASE_ANON_KEY_2 ||
    process.env.NEXT_PUBLIC_SUPABASE_NEW_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_NEW_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_NEW_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_NEW_SUPABASE_ANON_KEY;
  const legacyKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_RESUME_MRTS_SUPABASE_PUBLISHABLE_KEY ||
    process.env.RESUME_MRTS_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY_2 ||
    process.env.SUPABASE_PUBLISHABLE_KEY_3;
  const key = newUrl ? newKey : legacyKey;
  if (!url || !key) return null;

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") return null;
  } catch {
    return null;
  }

  return { url, key };
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
