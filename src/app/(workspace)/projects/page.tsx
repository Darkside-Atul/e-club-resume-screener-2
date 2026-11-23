import Link from "next/link";
import { ArrowUpRight, BriefcaseBusiness, CalendarDays } from "lucide-react";
import { Empty, Skills } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { projectColumns } from "@/lib/data";
import { formatDate } from "@/lib/format";
import type { Project } from "@/lib/types";

export const metadata = { title: "Explore projects" };

export default async function ProjectsPage() {
  const { db } = await requireSession("applicant");
  const { data, error } = await db.from("projects").select(projectColumns).eq("status", "published")
    .gt("deadline", new Date().toISOString()).order("deadline");
  if (error) throw new Error("projects_load_failed");
  const projects = (data || []) as Project[];
  return <>
    <section className="hero">
      <div className="hero-art" aria-hidden="true"><ArrowUpRight strokeWidth={0.45} /></div>
      <div className="hero-content">
        <span className="eyebrow"><BriefcaseBusiness size={16} aria-hidden="true" /> E-Club project opportunities</span>
        <h1>Explore projects</h1>
        <p>Find a team to build with. Browse open projects from Ashoka’s Entrepreneurship Club and apply with your resume.</p>
      </div>
    </section>
    <div className="section-heading"><h2>Open for applications</h2><span>{projects.length} {projects.length === 1 ? "project" : "projects"}</span></div>
    {projects.length === 0 ? <Empty title="No open projects">New opportunities will appear here when a project lead publishes them.</Empty>
      : <div className="project-grid">{projects.map((project) => <article key={project.id} className="panel project-card">
        <Link className="project-card-link" href={`/projects/${project.id}`} aria-label={`View ${project.name}`}>
          <div className="row between"><span className="icon-tile"><BriefcaseBusiness size={20} aria-hidden="true" /></span>
            <span className="pill pill-open"><span /> Open</span></div>
          <h3>{project.name}</h3>
          <p>{project.short_description}</p>
          <Skills items={project.required_skills} />
          <div className="project-foot"><span><CalendarDays size={16} aria-hidden="true" /> Closes {formatDate(project.deadline)}</span>
            <span>View project <ArrowUpRight size={17} aria-hidden="true" /></span></div>
        </Link>
      </article>)}</div>}
  </>;
}
