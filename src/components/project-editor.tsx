"use client";

import { useActionState, useState } from "react";
import { LockKeyhole, Plus, Trash2 } from "lucide-react";
import { saveProject } from "@/app/actions";
import { fieldDeadline } from "@/lib/format";
import { categories, type Criterion } from "@/lib/schema";
import type { Project, Rubric } from "@/lib/types";
import { SubmitButton } from "./forms";
import { Notice } from "./ui";

type EditorCriterion = Pick<Criterion, "id" | "category"> & { label: string; description: string; weight: string };
const newCriterion = (id: string): EditorCriterion => ({ id, label: "", description: "", category: "must_have", weight: "20" });

export function ProjectEditor({ project, rubric, past = false }: { project?: Project; rubric?: Rubric; past?: boolean }) {
  const [state, action] = useActionState(saveProject.bind(null, project?.id || null), {});
  const [rows, setRows] = useState<EditorCriterion[]>(rubric?.criteria.map((item) => ({ ...item, weight: String(item.weight) })) || [newCriterion("")]);
  const locked = !!project?.rubric_locked_at;
  const total = rows.reduce((sum, row) => sum + (Number(row.weight) || 0), 0);
  const patch = (index: number, change: Partial<EditorCriterion>) =>
    setRows((current) => current.map((row, i) => i === index ? { ...row, ...change } : row));
  const [details, setDetails] = useState({
    name: project?.name || "",
    short_description: project?.short_description || "",
    description: project?.description || "",
    required_skills: project?.required_skills.join("\n") || "",
    requirements: project?.requirements || "",
    questions: project?.questions.join("\n") || "",
    yes_threshold: String(rubric?.yes_threshold ?? 70),
    maybe_threshold: String(rubric?.maybe_threshold ?? 40),
    deadline: project ? fieldDeadline(project.deadline) : "",
    status: past && project?.status === "published" ? "closed" : project?.status || "draft",
  });
  const field = (name: keyof typeof details) => ({
    name,
    value: details[name],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setDetails((current) => ({ ...current, [name]: event.target.value })),
  });
  return <form action={action} className="form-stack editor">
    <section className="panel card form-stack">
      <h2>Project details</h2>
      <label>Project name <input {...field("name")} minLength={3} maxLength={100} required /></label>
      <label>Short description <input {...field("short_description")} minLength={10} maxLength={220} required /></label>
      <label>Full description <textarea {...field("description")} rows={5} minLength={20} maxLength={8000} required /></label>
      <div className="form-grid">
        <label>Required skills <textarea {...field("required_skills")} rows={4} maxLength={1620} required />
          <small>One skill per line, up to 20.</small></label>
        <label>Eligibility requirements <span className="optional">Optional</span>
          <textarea {...field("requirements")} rows={4} maxLength={2500} /></label>
      </div>
    </section>
    <section className="panel card form-stack">
      <header className="section-heading"><h2>Screening rubric</h2>{rubric && <span className="pill">Version {rubric.version}</span>}</header>
      {locked ? <div className="notice"><LockKeyhole size={17} aria-hidden="true" /> Imported applicants use this scoring snapshot, so the rubric is locked.</div>
        : <p className="muted">Each weight sets a criterion’s share of the score. The rubric locks when the first application arrives.</p>}
      {rows.map((row, index) => <fieldset key={row.id || "initial"} className="rubric-row" disabled={locked}>
        <legend>Criterion {index + 1}</legend>
        <input type="hidden" name="criterion_id" value={row.id} />
        <div className="form-grid">
          <label>Criterion name <input name="criterion_label" value={row.label} onChange={(event) => patch(index, { label: event.target.value })} required maxLength={120} /></label>
          <label>Category <select name="criterion_category" value={row.category}
            onChange={(event) => patch(index, { category: event.target.value as Criterion["category"] })}>
            {Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
        </div>
        <label>What counts as evidence <span className="optional">Optional</span>
          <textarea name="criterion_description" rows={2} maxLength={320} value={row.description}
            onChange={(event) => patch(index, { description: event.target.value })} /></label>
        <div className="row between wrap">
          <label className="weight">Weight <input name="criterion_weight" type="number" min={1} max={100}
            value={row.weight} required onChange={(event) => patch(index, { weight: event.target.value })} /></label>
          <small className="muted">{total > 0 ? (100 * (Number(row.weight) || 0) / total).toFixed(1) : "0"}% of total score</small>
          {!locked && rows.length > 1 && <button type="button" className="button button-quiet" aria-label={`Remove criterion ${index + 1}`}
            onClick={() => setRows((current) => current.filter((_, i) => i !== index))}><Trash2 size={16} /> Remove</button>}
        </div>
      </fieldset>)}
      {!locked && rows.length < 12 && <div><button type="button" className="button button-secondary"
        onClick={() => setRows((current) => [...current, newCriterion(crypto.randomUUID())])}><Plus size={16} aria-hidden="true" /> Add criterion</button></div>}
      <div className="form-grid">
        <label>Yes starts at <input {...field("yes_threshold")} type="number" min={2} max={100} readOnly={locked} required /></label>
        <label>Maybe starts at <input {...field("maybe_threshold")} type="number" min={1} max={99} readOnly={locked} required /></label>
      </div>
      <small className="muted">Scores below the Maybe threshold are grouped under No.</small>
    </section>
    <section className="panel card form-stack">
      <h2>Project status</h2>
      <div className="form-grid">
        <label>Application deadline (IST) <input {...field("deadline")} type="datetime-local"
          readOnly={project?.status === "closed" || (locked && past)} required /></label>
        <label>Status <select {...field("status")}>
          <option value="draft" disabled={project?.status === "closed"}>Draft</option>
          <option value="published" disabled={project?.status === "closed" || (locked && past)}>Active</option>
          <option value="closed">Closed</option>
        </select></label>
      </div>
      <Notice state={state} />
      <div><SubmitButton>{project ? "Save project" : "Create project"}</SubmitButton></div>
    </section>
  </form>;
}
