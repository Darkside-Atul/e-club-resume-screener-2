import Link from "next/link";
import { ArrowUpRight, CalendarDays, Download, Pencil, Search, UsersRound } from "lucide-react";
import { Back, Empty } from "@/components/ui";
import { Refresh } from "@/components/refresh";
import { InternalImport } from "@/components/internal-import";
import { resumeLimitBytes } from "@/lib/config";
import { requireSession } from "@/lib/auth";
import { deadlinePassed, getProject } from "@/lib/data";
import { decisionLabel, formatDateTime, screeningState } from "@/lib/format";
import { decisions, type Bucket, type Decision } from "@/lib/schema";

export const metadata = { title: "Project review" };

type Rank = {
  id: string; name: string; email: string; score: number | null; bucket: Bucket | null;
  matched_skills: string[] | null; flags: string[] | null; decision: Decision | null;
  job_status: string; error_code: string | null;
};

export default async function ProjectReview({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; decision?: string; page?: string }>;
}) {
  const { db, profile } = await requireSession("reviewer");
  const project = await getProject(db, (await params).id, profile.id);
  const controls = await searchParams;
  const query = (typeof controls.q === "string" ? controls.q : "").trim().slice(0, 100);
  const decision = [...decisions, "pending"].find((item) => item === controls.decision);
  const requestedPage = Number(controls.page);
  const page = Number.isSafeInteger(requestedPage) ? Math.max(1, Math.min(10000, requestedPage)) : 1;
  const size = 30;
  let request = db.from("ranked_applications")
    .select("id,name,email,score,bucket,matched_skills,flags,decision,job_status,error_code", { count: "exact" })
    .eq("project_id", project.id);
  if (query) request = request.ilike("search_text", `%${query.replace(/[\\%_*]/g, "\\$&")}%`);
  if (decision) request = decision === "pending" ? request.is("decision", null) : request.eq("decision", decision);
  const { data, error, count } = await request.order("bucket_order").order("score", { ascending: false, nullsFirst: false })
    .order("submitted_at").order("id").range((page - 1) * size, page * size - 1);
  if (error && error.code !== "PGRST103") throw new Error("ranking_load_failed");
  const rows = (data || []) as Rank[];
  const href = `/reviewer/${project.id}`;
  const exportReady = deadlinePassed(project.deadline);
  const pageHref = (next: number) => {
    const filters = new URLSearchParams({ page: String(next) });
    if (query) filters.set("q", query);
    if (decision) filters.set("decision", decision);
    return `${href}?${filters.toString()}`;
  };

  return <>
    <Back href="/reviewer">Your projects</Back>
    <header className="page-heading page-heading-actions"><div>
      <span className={project.status === "published" ? "pill pill-open" : "pill"}>
        {project.status === "published" ? "Active review" : project.status === "draft" ? "Draft" : "Project closed"}
      </span>
      <h1>{project.name}</h1><p>{project.short_description}</p>
      <div className="metadata"><CalendarDays size={16} aria-hidden="true" /> Deadline {formatDateTime(project.deadline)} <span>·</span> Rubric v{project.rubric_version}</div>
    </div><div className="row wrap header-actions">
      <Link className="button button-secondary" href={`${href}/edit`}><Pencil size={16} aria-hidden="true" /> Edit project</Link>
      {exportReady && <a className="button" href={`${href}/export`}><Download size={16} aria-hidden="true" /> Export shortlist</a>}
    </div></header>
    {!exportReady && <p className="muted export-note">Shortlist export opens after the application deadline.</p>}
    <InternalImport projectId={project.id} maxFileBytes={resumeLimitBytes()} />
    <div className="section-heading"><div><h2>Applicant review queue</h2><span>Compare relevant experience, review each applicant’s interests, and record your own decision.</span></div><Refresh /></div>
    <form className="panel filters" action={href}>
      <label><Search size={16} aria-hidden="true" /> Find an applicant<input name="q" defaultValue={query} maxLength={100} placeholder="Search by name or email" /></label>
      <label>Shortlist status<select name="decision" defaultValue={decision || ""}><option value="">Everyone</option>
        {[...decisions, "pending"].map((item) => <option key={item} value={item}>{decisionLabel(item)}</option>)}
      </select></label>
      <button className="button button-secondary" type="submit">Show applicants</button>
      {(query || decision) && <Link className="button button-quiet" href={href}>Clear</Link>}
    </form>
    {!rows.length ? <Empty icon={UsersRound} title={query || decision ? "No applicants found" : "No applications yet"}>
      {query || decision ? "Try another search or show everyone." : "Import a roster and resumes above to create the review queue."}</Empty>
      : <>
        <p className="result-count">{count ?? rows.length} {(count ?? rows.length) === 1 ? "applicant" : "applicants"} · ordered by suggested fit</p>
        <div className="panel table-scroll"><table><caption className="sr-only">Applicants for {project.name}, ordered by suggested fit</caption>
          <thead><tr><th>Applicant</th><th>Suggested fit</th><th>Relevant experience</th><th>Your decision</th><th><span className="sr-only">Open</span></th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id}>
            <th scope="row">{row.name}<span className="table-subtitle">{row.email}</span></th>
            <td>{row.score === null ? screeningState(row.job_status, row.error_code) : <><span className={`pill bucket-${(row.bucket || "").toLowerCase()}`}>{row.bucket}</span><span className="table-subtitle">Advisory match</span></>}</td>
            <td>{row.matched_skills?.length ? row.matched_skills.slice(0, 3).join(", ") : "Review application"}</td>
            <td><span className={`pill decision-${row.decision || "pending"}`}>{decisionLabel(row.decision || "pending")}</span></td>
            <td><Link className="table-link" href={`${href}/applicants/${row.id}`} aria-label={`Review ${row.name} application`}>Review <ArrowUpRight size={15} /></Link></td>
          </tr>)}</tbody>
        </table></div>
      </>}
    {(page > 1 || (count || 0) > page * size) && <nav className="pagination" aria-label="Application pages">
      {page > 1 && <Link className="button button-secondary" href={pageHref(page - 1)}>Previous</Link>}
      <span>Page {page}</span>
      {(count || 0) > page * size && <Link className="button button-secondary" href={pageHref(page + 1)}>Next</Link>}
    </nav>}
  </>;
}
