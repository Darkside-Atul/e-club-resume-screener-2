import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";
import { allowedEmail, publicConfig } from "./config";
import { userDb } from "./db";
import type { Profile } from "./types";

export const session = cache(async () => {
  if (!publicConfig()) return null;
  const db = await userDb();
  const { data: { user } } = await db.auth.getUser();
  if (!user || !user.email_confirmed_at || !allowedEmail(user.email)) return null;
  const { data, error } = await db.from("profiles")
    .select("id,email,name,student_id,role").eq("id", user.id).maybeSingle();
  if (error) throw new Error("profile_lookup_failed");
  if (!data || data.role !== "reviewer") return null;
  return { db, profile: data as Profile };
});

export function homeFor(role: Profile["role"]) {
  return role === "reviewer" ? "/reviewer" : "/sign-in";
}

export async function requireSession(role: Profile["role"] = "reviewer") {
  const current = await session();
  if (!current) redirect("/sign-in");
  if (role && current.profile.role !== role) redirect(homeFor(current.profile.role));
  return current;
}
