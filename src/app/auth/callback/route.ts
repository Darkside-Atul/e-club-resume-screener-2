import { allowedEmail, demoEnabled, publicConfig } from "@/lib/config";
import { userDb } from "@/lib/db";

export async function GET(request: Request) {
  if (demoEnabled()) return Response.redirect(new URL("/demo", request.url), 303);
  const target = (path: string) => Response.redirect(new URL(path, request.url), 303);
  if (!publicConfig()) return target("/sign-in?error=unavailable");
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const db = await userDb();
  const result = code ? await db.auth.exchangeCodeForSession(code) : null;

  if (result?.error || !result?.data.user) return target("/applicant/login?error=callback");
  if (!result.data.user.email_confirmed_at || !allowedEmail(result.data.user.email)) {
    await db.auth.signOut({ scope: "local" });
    return target("/sign-in?error=domain");
  }
  const { data: profile } = await db.from("profiles").select("role,name,student_id").eq("id", result.data.user.id).maybeSingle();
  if (!profile || (profile.role !== "reviewer" && profile.role !== "applicant")) {
    await db.auth.signOut({ scope: "local" });
    return target("/applicant/login?error=account");
  }
  if (profile.role === "reviewer") {
    await db.auth.signOut({ scope: "local" });
    return target("/sign-in?error=google");
  }
  return target(profile.name && profile.student_id ? "/projects" : "/profile");
}
