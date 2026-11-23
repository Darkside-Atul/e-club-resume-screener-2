import type { ReactNode } from "react";
import { ArrowUpRight, BriefcaseBusiness } from "lucide-react";
import { Brand } from "@/components/ui";

export function AuthLayout({ title, description, children }: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return <main id="main-content" className="sign-in">
    <div className="sign-in-intro">
      <Brand />
      <div className="sign-decoration" aria-hidden="true"><ArrowUpRight strokeWidth={0.58} /></div>
      <div className="sign-copy">
        <span className="eyebrow"><BriefcaseBusiness size={16} aria-hidden="true" /> Entrepreneurship Club</span>
        <h1>Find the right<br />project fit.</h1>
        <p>A private workspace for reviewers to add projects, check resumes, and review compatibility results.</p>
      </div>
    </div>
    <div className="sign-in-form">
      <div className="sign-form-inner">
        <span className="icon-tile"><ArrowUpRight size={24} aria-hidden="true" /></span>
        <h2>{title}</h2>
        <p>{description}</p>
        {children}
      </div>
    </div>
  </main>;
}
