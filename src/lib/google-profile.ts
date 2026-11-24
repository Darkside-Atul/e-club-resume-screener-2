import "server-only";

import { allowedEmail } from "./config";
import { serviceDb } from "./db";
import type { Profile } from "./types";

export async function resolveReviewerProfile(email: string | null | undefined): Promise<Profile | null> {
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail || !allowedEmail(normalizedEmail)) return null;

  try {
    const { data, error } = await serviceDb()
      .from("profiles")
      .select("id,name,email,student_id,role")
      .eq("email", normalizedEmail)
      .eq("role", "reviewer")
      .maybeSingle();

    if (error || data?.role !== "reviewer") return null;
    return data as Profile;
  } catch {
    return null;
  }
}

export async function authorizeGoogleReviewer(profile: {
  email?: unknown;
  email_verified?: unknown;
} | null | undefined) {
  if (profile?.email_verified !== true || typeof profile.email !== "string") return false;
  try {
    return !!(await resolveReviewerProfile(profile.email));
  } catch {
    return false;
  }
}
