import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { publicConfig } from "./config";

export async function userDb() {
  const config = publicConfig();
  if (!config) throw new Error("supabase_not_configured");
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (updates) => {
        try {
          for (const { name, value, options } of updates) store.set(name, value, options);
        } catch {
          // Server Components are read-only. Proxy persists refreshed cookies.
        }
      },
    },
  });
}

export function serviceDb() {
  const config = publicConfig();
  if (!config) throw new Error("supabase_service_not_configured");
  const newUrl =
    process.env.NEXT_PUBLIC_SUPABASE_NEW_SUPABASE_URL_2 ||
    process.env.SUPABASE_NEW_SUPABASE_URL_2 ||
    process.env.NEXT_PUBLIC_SUPABASE_NEW_SUPABASE_URL ||
    process.env.SUPABASE_NEW_SUPABASE_URL;
  const key = newUrl === config.url
    ? process.env.SUPABASE_NEW_SUPABASE_SECRET_KEY_2 ||
      process.env.SUPABASE_NEW_SUPABASE_SERVICE_ROLE_KEY_2 ||
      process.env.SUPABASE_NEW_SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_NEW_SUPABASE_SERVICE_ROLE_KEY
    : process.env.SUPABASE_SECRET_KEY ||
      process.env.RESUME_MRTS_SUPABASE_SECRET_KEY ||
      process.env.RESUME_MRTS_SUPABASE_SECRET_KEY_2 ||
      process.env.SUPABASE_SECRET_KEY_2 ||
      process.env.SUPABASE_SECRET_KEY_3;
  if (!key) throw new Error("supabase_service_not_configured");
  return createClient(config.url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
