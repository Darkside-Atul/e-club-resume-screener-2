import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";
import { auth as authjs } from "@/auth";
import { allowedEmail, demoEnabled } from "./config";
import { resolveReviewerProfile } from "./google-profile";
import { serviceDb } from "./db";
import type { Profile } from "./types";

export const session = cache(async () => {
  if (demoEnabled()) return null;
  const current = await authjs();
  const email = current?.user?.email;
  if (!email || current.user?.googleEmailVerified !== true || !allowedEmail(email)) return null;
  const profile = await resolveReviewerProfile(email);
  if (!profile || profile.role !== "reviewer") return null;
  return { db: serviceDb(), profile };
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
