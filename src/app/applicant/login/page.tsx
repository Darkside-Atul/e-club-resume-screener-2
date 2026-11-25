import Link from "next/link";
import { redirect } from "next/navigation";
import { signInGoogle } from "@/app/actions";
import { AuthLayout } from "@/components/auth-layout";
import { PasswordSignInForm, SubmitButton } from "@/components/forms";
import { homeFor, session } from "@/lib/auth";
import { authorizedDomain, demoEnabled, publicConfig } from "@/lib/config";

export const metadata = { title: "Applicant login" };

export default async function ApplicantLogin({ searchParams }: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (demoEnabled()) redirect("/demo");
  const existing = await session();
  if (existing) redirect(homeFor(existing.profile.role));
  const code = (await searchParams).error;
  const enabled = !!publicConfig();
  const google = enabled && process.env.GOOGLE_OAUTH_ENABLED === "true";
  return <AuthLayout audience="applicant" title="Applicant login" description="Sign in to explore open projects and manage your applications.">
    {!enabled && <div className="notice" role="status">Sign-in is unavailable until the portal is connected to Supabase.</div>}
    {code && <div className="notice notice-error" role="alert">{code === "domain"
      ? `Use your @${authorizedDomain()} campus account.`
      : code === "unavailable" ? "Google sign-in is temporarily unavailable. Use your campus email and password instead."
      : "We couldn’t complete sign-in. Please try again."}</div>}
    {google && <><form action={signInGoogle}><input type="hidden" name="role" value="applicant" />
      <SubmitButton secondary busy="Connecting…">Continue with Google</SubmitButton></form>
      <div className="divider"><span>or sign in with email</span></div></>}
    {enabled && <PasswordSignInForm domain={authorizedDomain()} enabled={enabled} role="applicant" />}
    <small>New to E-Club Projects? <Link href="/applicant/sign-up">Create an applicant account</Link></small>
    <small>Reviewer? <Link href="/sign-in">Go to reviewer sign in</Link></small>
  </AuthLayout>;
}
