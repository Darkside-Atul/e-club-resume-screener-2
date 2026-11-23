"use client";

import { Check, LoaderCircle, Save } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Candidate = {
  id: string;
  applicant_name: string | null;
  applicant_email: string | null;
  created_at: string;
  profile: {
    name?: string | null;
    email?: string | null;
    year?: string | null;
    interests?: string[];
    skills?: string[];
    relevant_experience?: string[];
  } | null;
};

function CandidateRow({ candidate, projectId }: { candidate: Candidate; projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const profile = candidate.profile || {};
  const formId = `profile-${candidate.id}`;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const profileData = {
      name: String(form.get("name") || "").trim() || null,
      email: String(form.get("email") || "").trim().toLowerCase(),
      year: String(form.get("year") || "").trim() || null,
      interests: String(form.get("interests") || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
      skills: String(form.get("skills") || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
      relevant_experience: String(form.get("experience") || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
    };
    try {
      const response = await fetch("/api/candidates/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, applicationId: candidate.id, profile: profileData }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Profile could not be saved.");
      setMessage("Saved");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Profile could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return <tr>
    <th scope="row" className="candidate-record">
      <span>{candidate.applicant_name || profile.name || "Name not provided"}</span>
      <small>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(candidate.created_at))}</small>
    </th>
    <td colSpan={6}>
      <form id={formId} className="candidate-edit-grid" onSubmit={save} aria-busy={busy}>
        <label><span className="sr-only">Name</span><input name="name" aria-label="Name" maxLength={100} defaultValue={profile.name || candidate.applicant_name || ""} placeholder="Name" /></label>
        <label><span className="sr-only">Email</span><input name="email" type="email" aria-label="Email" maxLength={320} defaultValue={profile.email || candidate.applicant_email || ""} placeholder="Email" /></label>
        <label><span className="sr-only">Year</span><input name="year" aria-label="Year" maxLength={80} defaultValue={profile.year || ""} placeholder="Year" /></label>
        <label><span className="sr-only">Interests, one per line</span><textarea name="interests" aria-label="Interests, one per line" rows={2} defaultValue={(profile.interests || []).join("\n")} placeholder="Interests" /></label>
        <label><span className="sr-only">Skills, one per line</span><textarea name="skills" aria-label="Skills, one per line" rows={2} defaultValue={(profile.skills || []).join("\n")} placeholder="Skills" /></label>
        <label className="experience-cell"><span className="sr-only">Relevant experience, one per line</span><textarea name="experience" aria-label="Relevant experience, one per line" rows={2} defaultValue={(profile.relevant_experience || []).join("\n")} placeholder="Relevant experience" /></label>
      </form>
    </td>
    <td className="candidate-save-cell">
      <button className="button button-secondary" type="submit" form={formId} disabled={busy}>
        {busy ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : message === "Saved" ? <Check size={15} aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
        {busy ? "Saving" : "Save"}
      </button>
      <span className={message && message !== "Saved" ? "candidate-save-error" : "candidate-save-status"} role="status">{message}</span>
    </td>
  </tr>;
}

export function CandidateProfileTable({ candidates, projectId }: { candidates: Candidate[]; projectId: string }) {
  if (!candidates.length) return <section className="panel empty"><h2>Candidate profiles</h2><p>Profiles from individual or bulk uploads will appear here for review.</p></section>;
  return <section className="panel candidate-table-panel" aria-labelledby="candidate-profiles-title">
    <div className="card section-heading candidate-table-heading">
      <div><h2 id="candidate-profiles-title">Candidate profiles</h2><p>Review and edit AI-extracted details before screening completes.</p></div>
      <span className="pill">{candidates.length} shown</span>
    </div>
    <div className="table-scroll candidate-table-scroll">
      <table className="candidate-table">
        <thead><tr><th scope="col">Candidate</th><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Year</th><th scope="col">Interests</th><th scope="col">Skills</th><th scope="col">Relevant experience</th><th scope="col">Actions</th></tr></thead>
        <tbody>{candidates.map((candidate) => <CandidateRow key={candidate.id} candidate={candidate} projectId={projectId} />)}</tbody>
      </table>
    </div>
    {candidates.length === 100 && <p className="candidate-table-note">Showing the most recent 100 uploaded candidates.</p>}
  </section>;
}
