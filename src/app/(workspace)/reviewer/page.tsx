import Link from "next/link";
import { ArrowUpRight, CalendarDays, FolderKanban, Plus } from "lucide-react";
import { Empty, Skills } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { isOpen, projectColumns } from "@/lib/data";
import { formatDate } from "@/lib/format";
import type { Project } from "@/lib/types";

export const metadata = { title: "Reviewer dashboard" };

export default async function Reviewer() {
  const { db, profile } = await requireSession("reviewer");
  const { data, error } = await db.from("projects").select(projectColumns).eq("reviewer_id", profile.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error("reviewer_projects_load_failed");
  const projects = (data || []) as Project[];
  const newProject = <Link className="button" href="/reviewer/new"><Plus size={18} aria-hidden="true" /> New project</Link>;
  return <>
    <section className="hero hero-review">
      <div className="hero-art" aria-hidden="true"><ArrowUpRight strokeWidth={0.45} /></div>
      <div className="hero-content">
        <span className="eyebrow"><FolderKanban size={16} aria-hidden="true" /> Reviewer workspace</span>
        <h1>Your projects</h1>
        <p>Add projects, run resume compatibility checks, and review the results in one private workspace.</p>
      </div>
    </section>
    <div className="section-heading"><h2>Projects you lead</h2>{newProject}</div>
    {!projects.length ? <Empty title="Create your first project" icon={FolderKanban}>Add the project details, application deadline and screening rubric to get started.</Empty>
      : <div className="project-grid">{projects.map((project) => <article className="panel project-card" key={project.id}>
        <div className="row between">
          <span className="icon-tile"><FolderKanban size={20} aria-hidden="true" /></span>
          <span className={isOpen(project) ? "pill pill-open" : "pill"}>{isOpen(project) ? "Open" : project.status === "draft" ? "Draft" : "Closed"}</span>
        </div>
        <h3><Link href={`/reviewer/${project.id}`}>{project.name}</Link></h3><p>{project.short_description}</p>
        <Skills items={project.required_skills} />
        <div className="project-foot"><span><CalendarDays size={16} aria-hidden="true" /> Deadline {formatDate(project.deadline)}</span>
          <Link href={`/reviewer/${project.id}`}>Review <ArrowUpRight size={17} /></Link></div>
      </article>)}</div>}
  </>;
}
