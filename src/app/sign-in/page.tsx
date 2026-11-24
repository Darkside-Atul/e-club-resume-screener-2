import { redirect } from "next/navigation";
import { signInGoogle } from "@/app/actions";
import { AuthLayout } from "@/components/auth-layout";
import { SubmitButton } from "@/components/forms";
import { homeFor, session } from "@/lib/auth";
import { demoEnabled } from "@/lib/config";

export const metadata = { title: "Sign in" };

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (demoEnabled()) redirect("/demo");
  const existing = await session();
  if (existing) redirect(homeFor(existing.profile.role));
  const code = (await searchParams).error;
  const enabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET && process.env.AUTH_SECRET);
  return <AuthLayout title="Reviewer sign in" description="Sign in with your authorized E-Club reviewer account.">
    {!enabled && <div className="notice" role="status">Google sign-in is not configured for this deployment.</div>}
    {code && <div className="notice notice-error" role="alert">{code === "AccessDenied"
      ? "Use your verified campus Google account with reviewer access."
      : "We couldn’t sign you in. Please try again."}</div>}
    {enabled && <form action={signInGoogle}><SubmitButton secondary busy="Connecting…">Continue with Google</SubmitButton></form>}
  </AuthLayout>;
}
