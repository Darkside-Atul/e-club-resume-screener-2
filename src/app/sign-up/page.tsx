import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/auth-layout";
import { PasswordSignUpForm } from "@/components/forms";
import { homeFor, session } from "@/lib/auth";
import { authorizedDomain, demoEnabled, publicConfig } from "@/lib/config";

export const metadata = { title: "Create account" };
export const dynamic = "force-dynamic";

export default async function SignUp() {
  if (demoEnabled()) redirect("/demo");
  const existing = await session();
  if (existing) redirect(homeFor(existing.profile.role));
  const enabled = !!publicConfig();
  return <AuthLayout title="Create your account" description="Create an account with your Ashoka University email and password.">
    {!enabled && <div className="notice" role="status">Account creation is unavailable until the portal is connected to Supabase.</div>}
    {enabled && <>
      <p className="auth-hint">Create your account with your @{authorizedDomain()} email and a password. You can sign in right away.</p>
      <PasswordSignUpForm domain={authorizedDomain()} enabled={enabled} />
    </>}
    <small>Already have an account? <Link href="/sign-in">Sign in</Link></small>
  </AuthLayout>;
}
