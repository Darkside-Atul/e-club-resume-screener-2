"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { KeyRound, LayoutDashboard } from "lucide-react";

export function Navigation({ reviewer }: { reviewer: boolean }) {
  const path = usePathname();
  const nav = reviewer ? [
    { href: "/reviewer", label: "Reviewer dashboard", icon: LayoutDashboard },
    { href: "/reviewer/access", label: "Team access", icon: KeyRound },
  ] : [];
  return <nav aria-label="Main navigation" className="navigation">
    {nav.map(({ href, label, icon: Icon }) =>
      <Link key={href} href={href} aria-current={path === href || path.startsWith(`${href}/`) ? "page" : undefined}>
        <Icon size={16} aria-hidden="true" /> {label}
      </Link>)}
  </nav>;
}
