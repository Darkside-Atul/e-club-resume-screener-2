"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { FileUp, ShieldCheck } from "lucide-react";

export function InternalImport({ projectId, maxFileBytes }: { projectId: string; maxFileBytes: number }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [studentId, setStudentId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function runCheck(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    setError("");
    setNotice("");
    if (!file || (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf")) {
      setError("Choose a PDF resume to run the check.");
      return;
    }
    if (file.size > maxFileBytes) {
      setError("This PDF exceeds the configured file size limit.");
      return;
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) {
      setError("Private storage is not configured for this environment.");
      return;
    }

    setBusy(true);
    try {
      const start = await fetch("/api/internal/import/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          size: file.size,
          mediaType: "application/pdf",
          name: name.trim(),
          email: email.trim().toLowerCase(),
          studentId: studentId.trim(),
          interests: [],
        }),
      });
      const signed = await start.json().catch(() => ({}));
      if (!start.ok || typeof signed.path !== "string" || typeof signed.token !== "string") {
        throw new Error(signed.error || "Could not prepare the private upload.");
      }

      const storage = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const uploaded = await storage.storage.from("resumes").uploadToSignedUrl(signed.path, signed.token, file, {
        contentType: "application/pdf",
        upsert: false,
      });
      if (uploaded.error) throw new Error("The PDF could not be uploaded to private storage.");

      const complete = await fetch("/api/internal/import/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          path: signed.path,
          name: name.trim(),
          email: email.trim().toLowerCase(),
          studentId: studentId.trim(),
          interests: [],
        }),
      });
      const result = await complete.json().catch(() => ({}));
      if (!complete.ok) throw new Error(result.error || "The resume could not be saved.");

      setNotice(`Compatibility check started for ${name.trim()}. Results will appear below.`);
      setName("");
      setEmail("");
      setStudentId("");
      setFile(null);
      form.reset();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The check could not be started. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel card form-stack import-panel" aria-labelledby="import-title">
    <div className="section-heading"><div>
      <h2 id="import-title"><FileUp size={19} aria-hidden="true" /> Add a resume</h2>
      <p className="muted">Add the candidate details and PDF, then run a compatibility check against this project.</p>
    </div><span className="pill"><ShieldCheck size={14} aria-hidden="true" /> Private storage</span></div>
    <div className="notice"><ShieldCheck size={17} aria-hidden="true" /> Resume text is extracted and redacted before approved Gemini processing. The PDF is stored privately and is never sent directly to the model.</div>
    <form className="form-stack" onSubmit={runCheck}>
      <div className="form-grid import-inputs">
        <label>Candidate name<input name="name" autoComplete="name" required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Candidate email<input name="email" type="email" autoComplete="email" required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Student ID <span className="optional">Optional</span><input name="student_id" maxLength={40} value={studentId} onChange={(event) => setStudentId(event.target.value)} /></label>
        <label>Resume PDF<input name="resume" type="file" accept="application/pdf,.pdf" required onChange={(event) => setFile(event.target.files?.[0] || null)} />
          <small>PDF only; maximum size {Math.round(maxFileBytes / (1024 * 1024))} MB.</small></label>
      </div>
      {error && <p role="alert" className="notice notice-error">{error}</p>}
      {notice && <p role="status" className="notice notice-success">{notice}</p>}
      <div><button className="button" type="submit" disabled={busy}>{busy ? "Running check…" : "Run Check"}</button></div>
    </form>
  </section>;
}
