import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/auth-layout";
import { PasswordSignUpForm } from "@/components/forms";
import { homeFor, session } from "@/lib/auth";
import { authorizedDomain, demoEnabled, publicConfig } from "@/lib/config";

export const metadata = { title: "Create applicant account" };

export default async function ApplicantSignUp() {
  if (demoEnabled()) redirect("/demo");
  const existing = await session();
  if (existing) redirect(homeFor(existing.profile.role));
  const enabled = !!publicConfig();
  return <AuthLayout audience="applicant" title="Create an account" description="Use your campus email to apply to Entrepreneurship Club projects.">
    {!enabled && <div className="notice" role="status">Account creation is unavailable until the portal is connected to Supabase.</div>}
    {enabled && <PasswordSignUpForm domain={authorizedDomain()} enabled={enabled} />}
    <small>Already have an account? <Link href="/applicant/login">Sign in</Link></small>
    <small>Reviewer? <Link href="/sign-in">Go to reviewer sign in</Link></small>
  </AuthLayout>;
}
