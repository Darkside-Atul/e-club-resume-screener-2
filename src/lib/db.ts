import "server-only";

import { createClient } from "@supabase/supabase-js";
import { publicConfig } from "./config";

export function serviceDb() {
  const config = publicConfig();
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.RESUME_MRTS_SUPABASE_SECRET_KEY ||
    process.env.RESUME_MRTS_SUPABASE_SECRET_KEY_2 ||
    process.env.SUPABASE_SECRET_KEY_2 ||
    process.env.SUPABASE_SECRET_KEY_3;
  if (!config || !key) throw new Error("supabase_service_not_configured");
  return createClient(config.url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
