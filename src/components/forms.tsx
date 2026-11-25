"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";
import { retryScreening, saveDecision, updateProfile } from "@/app/actions";
import { decisions } from "@/lib/schema";
import { decisionLabel } from "@/lib/format";
import type { Profile, Review } from "@/lib/types";
import { Notice } from "./ui";

export function SubmitButton({ children, busy = "Saving…", secondary = false }: {
  children: React.ReactNode; busy?: string; secondary?: boolean;
}) {
  const { pending } = useFormStatus();
  return <button className={secondary ? "button button-secondary" : "button"} type="submit" disabled={pending}>
    {pending && <LoaderCircle size={16} className="spin" aria-hidden="true" />}{pending ? busy : children}
  </button>;
}

export function ProfileForm({ profile }: { profile: Profile }) {
  const [state, action] = useActionState(updateProfile, {});
  return <form action={action} className="form-stack">
    <label>Full name <input name="name" defaultValue={profile.name} autoComplete="name" maxLength={100} required /></label>
    <label>Campus email <input type="email" value={profile.email} readOnly /></label>
    <label>Student ID <input name="student_id" defaultValue={profile.student_id || ""} maxLength={40} required /></label>
    <Notice state={state} />
    <div><SubmitButton>Save profile</SubmitButton></div>
  </form>;
}

export function DecisionForm({ applicationId, version, review }: { applicationId: string; version: number; review: Review | null }) {
  const [state, action] = useActionState(saveDecision, {});
  return <form action={action} className="form-stack">
    <input type="hidden" name="application_id" value={applicationId} />
    <input type="hidden" name="version" value={version} />
    <label>Decision <select name="decision" required defaultValue={review?.decision || ""}>
      <option value="" disabled>Choose a decision</option>
      {decisions.map((decision) => <option key={decision} value={decision}>{decisionLabel(decision)}</option>)}
    </select></label>
    <label>Private note <span className="optional">Optional</span>
      <textarea name="note" rows={4} maxLength={2000} defaultValue={review?.note || ""} />
    </label>
    <Notice state={state} />
    <div><SubmitButton>Record decision</SubmitButton></div>
  </form>;
}

export function RetryForm({ applicationId, version }: { applicationId: string; version: number }) {
  const [state, action] = useActionState(retryScreening, {});
  return <form action={action} className="form-stack">
    <input type="hidden" name="application_id" value={applicationId} />
    <input type="hidden" name="version" value={version} />
    <Notice state={state} />
    <div><SubmitButton secondary busy="Queuing…">Retry screening</SubmitButton></div>
  </form>;
}
