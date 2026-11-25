import { LogOut } from "lucide-react";
import { signOut } from "@/app/actions";
import { Navigation } from "@/components/nav";
import { Brand } from "@/components/ui";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Workspace({ children }: { children: React.ReactNode }) {
  const { profile } = await requireSession();
  return <div className="workspace">
    <header className="topbar"><div className="topbar-inner">
      <Brand href="/reviewer" />
      <Navigation reviewer={profile.role === "reviewer"} />
      <form action={signOut} className="sign-out"><button type="submit" className="button button-quiet">
        <LogOut size={16} aria-hidden="true" /><span>Sign out</span>
      </button></form>
    </div></header>
    <main id="main-content" className="container">{children}</main>
    <footer className="footer"><span>Entrepreneurship Club</span><span>Ashoka University</span></footer>
  </div>;
}
