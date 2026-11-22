import { redirect } from "next/navigation";
import { signInGoogle } from "@/app/actions";
import { AuthLayout } from "@/components/auth-layout";
import { PasswordSignInForm, SubmitButton } from "@/components/forms";
import { homeFor, session } from "@/lib/auth";
import { authorizedDomain, demoEnabled, publicConfig } from "@/lib/config";

export const metadata = { title: "Sign in" };

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (demoEnabled()) redirect("/demo");
  const existing = await session();
  if (existing) redirect(homeFor(existing.profile.role));
  const code = (await searchParams).error;
  const enabled = !!publicConfig();
  const google = enabled && process.env.GOOGLE_OAUTH_ENABLED === "true";
  return <AuthLayout title="Reviewer sign in" description="Sign in with your authorized E-Club reviewer account.">
    {!enabled && <div className="notice" role="status">Sign-in is unavailable until the portal is connected to Supabase.</div>}
    {code && <div className="notice notice-error" role="alert">{code === "domain"
      ? `Sign in with your @${authorizedDomain()} account.`
      : code === "internal" ? "This workspace is available to authorized E-Club reviewers only."
      : "We couldn’t sign you in. Please try again."}</div>}
    {google && <><form action={signInGoogle}><SubmitButton secondary busy="Connecting…">Continue with Google</SubmitButton></form>
      <div className="divider"><span>or sign in with email</span></div></>}
    {enabled && <PasswordSignInForm domain={authorizedDomain()} enabled={enabled} />}
  </AuthLayout>;
}
