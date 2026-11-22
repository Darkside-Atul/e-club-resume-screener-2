import { ArrowUpRight, FileText, Info } from "lucide-react";
import { Back, Skills } from "@/components/ui";
import { DecisionForm, RetryForm } from "@/components/forms";
import { Refresh } from "@/components/refresh";
import { requireSession } from "@/lib/auth";
import { getApplication, getProject } from "@/lib/data";
import { decisionLabel, formatDateTime, screeningState } from "@/lib/format";
import type { Review, Screening } from "@/lib/types";

export const metadata = { title: "Review application" };

const reasons: Record<string, string> = {
  no_readable_text: "The PDF does not have enough reliably extractable text. Read the original resume to review this application.",
  unsupported_pdf: "The resume exceeds the text processing limits. Read the original resume to review this application.",
  invalid_pdf: "The worker couldn’t parse this PDF. Review the stored resume or contact the applicant.",
  ai_disabled: "AI screening is disabled for this deployment. You can review the resume and record a decision.",
  privacy_guard: "The current AI configuration does not allow processing this submission. Review the resume manually.",
  model_unconfigured: "The screening provider is missing configuration. You can review manually while it is being set up.",
  invalid_model_output: "The AI response could not be validated against the rubric and source evidence.",
  worker_interrupted: "The screening worker stopped before completing this job.",
};

export default async function ApplicantReview({ params }: { params: Promise<{ id: string; applicationId: string }> }) {
  const { db, profile } = await requireSession("reviewer");
  const { id, applicationId } = await params;
  const project = await getProject(db, id, profile.id);
  const application = await getApplication(db, id, applicationId);
  const version = application.submission_version;
  const [profileResult, screeningResult, jobResult, decisionResult, history] = await Promise.all([
    application.user_id
      ? db.from("profiles").select("name,email,student_id").eq("id", application.user_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db.from("screenings").select("*").eq("application_id", applicationId).eq("submission_version", version).maybeSingle(),
    db.from("screening_jobs").select("status,error_code").eq("application_id", applicationId).eq("submission_version", version).maybeSingle(),
    db.from("decisions").select("decision,note,decided_at,decided_by,submission_version")
      .eq("application_id", applicationId).eq("submission_version", version).maybeSingle(),
    db.from("decision_history").select("id,decision,note,decided_at,decided_by,submission_version").eq("application_id", applicationId)
      .order("decided_at", { ascending: false }).order("id", { ascending: false }),
  ]);
  const applicant = {
    name: application.applicant_name || profileResult.data?.name || "",
    email: application.applicant_email || profileResult.data?.email || "",
    student_id: application.applicant_student_id || profileResult.data?.student_id || null,
  };
  if ([profileResult, screeningResult, jobResult, decisionResult, history].some(({ error }) => error) || !applicant.name || !applicant.email) {
    throw new Error("review_load_failed");
  }
  const screening = screeningResult.data as Screening | null;
  const review = decisionResult.data as Review | null;
  const job = jobResult.data;
  const resume = `/reviewer/${id}/applicants/${applicationId}/resume?v=${version}`;
  const canRetry = job?.status === "failed" && !["no_readable_text", "invalid_pdf", "unsupported_pdf"].includes(job?.error_code || "");

  return <>
    <Back href={`/reviewer/${id}`}>{project.name}</Back>
    <header className="page-heading page-heading-actions"><div>
      <h1>{applicant.name}</h1>
      <p>{applicant.email}{applicant.student_id && ` · Student ID ${applicant.student_id}`}</p>
      <div className="metadata">Submitted {formatDateTime(application.submitted_at)} <span>·</span> Submission v{version}</div>
    </div><Refresh /></header>
    <div className="review-grid">
      <div className="form-stack">
        <section className="panel resume-panel">
          <div className="section-heading card"><h2><FileText size={20} aria-hidden="true" /> Resume</h2>
            <a className="button button-secondary" href={resume} target="_blank" rel="noreferrer">Open PDF <ArrowUpRight size={16} /></a></div>
          <iframe key={version} src={resume} title={`PDF resume for ${applicant.name}`} referrerPolicy="no-referrer" />
        </section>
        {(application.links.length > 0 || application.answers.length > 0 || application.applicant_interests.length > 0) && <section className="panel card form-stack">
          <h2>Application responses</h2>
          {application.applicant_interests.length > 0 && <div><h3>Applicant interests</h3><Skills items={application.applicant_interests} /></div>}
          {application.links.length > 0 && <div><h3>Portfolio and project links</h3><ul className="link-list">
            {application.links.map((link, i) => <li key={i}><a href={link} target="_blank" rel="noreferrer">{link} <ArrowUpRight size={14} /></a></li>)}
          </ul></div>}
          {application.answers.map((answer, i) => <div key={i}><h3>{project.questions[i] || `Question ${i + 1}`}</h3><p className="prose-text">{answer}</p></div>)}
        </section>}
      </div>
      <div className="form-stack">
        <section className="panel card form-stack">
          <div className="section-heading"><h2>AI screening</h2><span className={screening ? `pill bucket-${screening.bucket.toLowerCase()}` : "pill"}>
            {screening?.bucket || screeningState(job?.status, job?.error_code)}</span></div>
          {screening ? <>
            <div className="score"><strong>{screening.score}</strong><span> / 100</span></div>
            <p>{screening.summary}</p>
            <div className="notice"><Info size={17} aria-hidden="true" /> Verify the evidence yourself before recording a decision.</div>
            {!!screening.matched_skills.length && <div><h3>Matched criteria</h3><Skills items={screening.matched_skills} /></div>}
            {!!screening.missing_skills.length && <div><h3>Unverified criteria</h3><Skills items={screening.missing_skills} /></div>}
            <div><h3>Evidence by criterion</h3><ul className="evidence-list">
              {screening.criterion_evidence.map((item) => <li key={item.criterion_id}>
                <div className="row between wrap"><strong>{item.label}</strong><span className={`pill evidence-${item.status}`}>
                  {{ met: "Met", partial: "Partial", unverified: "Unverified" }[item.status]}</span></div>
                {item.quote ? <blockquote>“{item.quote}”</blockquote> : <p className="muted">No verifiable evidence in the supplied material.</p>}
              </li>)}
            </ul></div>
            {screening.flags.length > 0 && <div><h3>Flags to check</h3><ul className="flag-list">{screening.flags.map((flag, i) => <li key={i}>{flag}</li>)}</ul></div>}
            <small className="muted">Rubric v{screening.rubric_version} · {screening.model_version}</small>
          </> : <><p>{job?.status === "failed"
            ? reasons[job.error_code || ""] || "Automated screening couldn’t complete. Read the original application for a manual review."
            : "The resume is ready to review while screening is pending."}</p>
            {canRetry && <RetryForm applicationId={application.id} version={version} />}</>}
        </section>
        <section className="panel card form-stack">
          <div className="section-heading"><h2>Reviewer decision</h2><span className={`pill decision-${review?.decision || "pending"}`}>{decisionLabel(review?.decision || "pending")}</span></div>
          <DecisionForm key={`${version}:${review?.decided_at || ""}`} applicationId={application.id} version={version} review={review} />
          {!!history.data?.length && <details><summary>Decision history ({history.data.length})</summary>
            <ul className="evidence-list">{history.data.map((entry) => <li key={entry.id}>
              <strong>{decisionLabel(entry.decision)}</strong> · Submission v{entry.submission_version}
              <div className="muted">{formatDateTime(entry.decided_at)} · {entry.decided_by === profile.id ? profile.name || profile.email : entry.decided_by}</div>
              {entry.note && <p className="prose-text">{entry.note}</p>}
            </li>)}</ul>
          </details>}
        </section>
      </div>
    </div>
  </>;
}
