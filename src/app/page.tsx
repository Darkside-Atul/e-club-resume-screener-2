import { redirect } from "next/navigation";
import { homeFor, session } from "@/lib/auth";

import { demoEnabled } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (demoEnabled() || process.env.NODE_ENV === "development") redirect("/demo");
  const current = await session();
  redirect(current ? homeFor(current.profile.role) : "/sign-in");
}
