import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: NonNullable<DefaultSession["user"]> & {
      googleEmailVerified: boolean;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    googleEmailVerified?: boolean;
  }
}
