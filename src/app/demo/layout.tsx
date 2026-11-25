import Link from "next/link";
import { BriefcaseBusiness, ClipboardList, Eye } from "lucide-react";
import { notFound } from "next/navigation";
import { Brand } from "@/components/ui";
import { demoEnabled } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  if (!demoEnabled() && process.env.NODE_ENV !== "development") notFound();

  return <div className="workspace">
    <header className="topbar"><div className="topbar-inner">
      <Brand href="/demo" />
      <nav className="navigation" aria-label="Demo navigation">
        <Link href="/demo"><BriefcaseBusiness size={16} aria-hidden="true" /> Explore projects</Link>
        <Link href="/demo/reviewer"><ClipboardList size={16} aria-hidden="true" /> Reviewer example</Link>
      </nav>
      <span className="pill"><Eye size={14} aria-hidden="true" /> Read-only demo</span>
    </div></header>
    <main id="main-content" className="container">{children}</main>
    <footer className="footer"><span>Entrepreneurship Club</span><span>Synthetic examples</span></footer>
  </div>;
}
