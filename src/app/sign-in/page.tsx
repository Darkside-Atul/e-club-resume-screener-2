import Link from "next/link";
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
  return <AuthLayout title="Sign in" description="Use your Ashoka University email to access the project portal.">
    {!enabled && <div className="notice" role="status">Sign-in is unavailable until the portal is connected to Supabase.</div>}
    {code && <div className="notice notice-error" role="alert">{code === "domain"
      ? `Sign in with your @${authorizedDomain()} account.`
      : "We couldn’t sign you in. Please try again."}</div>}
    {google && <><form action={signInGoogle}><SubmitButton secondary busy="Connecting…">Continue with Google</SubmitButton></form>
      <div className="divider"><span>or sign in with email</span></div></>}
    {enabled && <PasswordSignInForm domain={authorizedDomain()} enabled={enabled} />}
    <small>New to E-Club? <Link href="/sign-up">Create an account</Link></small>
  </AuthLayout>;
}
