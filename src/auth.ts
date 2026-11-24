import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { authorizeGoogleReviewer } from "@/lib/google-profile";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      authorization: {
        params: {
          hd: process.env.AUTHORIZED_EMAIL_DOMAIN || "ashoka.edu.in",
          prompt: "select_account",
        },
      },
    }),
  ],
  trustHost: true,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/sign-in" },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return false;
      return authorizeGoogleReviewer(profile);
    },
    async jwt({ token, profile }) {
      if (profile) token.googleEmailVerified = (profile as { email_verified?: boolean }).email_verified === true;
      return token;
    },
    async session({ session, token }) {
      if (session.user) session.user.googleEmailVerified = token.googleEmailVerified === true;
      return session;
    },
  },
});
