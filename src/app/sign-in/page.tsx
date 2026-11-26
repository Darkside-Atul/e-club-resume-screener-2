import { redirect } from "next/navigation";
import Link from "next/link";
import { AuthLayout } from "@/components/auth-layout";
import { PasswordSignInForm } from "@/components/forms";
import { homeFor, session } from "@/lib/auth";
import { demoEnabled, publicConfig } from "@/lib/config";

export const metadata = { title: "Sign in" };

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (demoEnabled()) redirect("/demo");
  const existing = await session();
  if (existing) redirect(homeFor(existing.profile.role));
  const code = (await searchParams).error;
  const enabled = !!publicConfig();
  return <AuthLayout title="Reviewer sign in" description="Sign in with your authorized E-Club reviewer account.">
    {!enabled && <div className="notice" role="status">Sign-in is unavailable until the portal is connected to Supabase.</div>}
    {code && <div className="notice notice-error" role="alert">{code === "google"
      ? "Google sign-in is for applicants. Use your reviewer email and password here."
      : "We couldn’t sign you in. Please try again."}</div>}
    {enabled && <PasswordSignInForm enabled={enabled} role="reviewer" />}
    <small>Applying to a project? <Link href="/applicant/login">Go to applicant login</Link></small>
  </AuthLayout>;
}
