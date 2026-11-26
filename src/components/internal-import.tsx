"use client";

import { createClient } from "@supabase/supabase-js";
import { FileUp, LoaderCircle, ShieldCheck, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent, type FormEvent } from "react";

const fileLimit = 5 * 1024 * 1024;

type CandidateDetails = { name: string; email: string; links: string[]; notes: string };

async function readJson(response: Response) {
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || "The candidate could not be saved.");
  return value;
}

export function InternalImport({ projectId, maxFileBytes }: { projectId: string; maxFileBytes: number }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [resume, setResume] = useState<File | null>(null);
  const [extras, setExtras] = useState<File[]>([]);
  const [bulkFiles, setBulkFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState("");
  const [busy, setBusy] = useState(false);

  function validateFiles(files: File[]) {
    if (files.some((file) => !file.name.toLowerCase().endsWith(".pdf") || (file.type && file.type !== "application/pdf"))) {
      throw new Error("Choose PDF files only.");
    }
    if (files.some((file) => file.size > fileLimit || file.size > maxFileBytes)) {
      throw new Error("Each PDF must be no larger than 5 MB.");
    }
  }

  async function uploadFile(file: File) {
    const signed = await readJson(await fetch("/api/candidates/upload/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, size: file.size, mediaType: "application/pdf" }),
    }));
    const newUrl = process.env.NEXT_PUBLIC_SUPABASE_NEW_SUPABASE_URL_2 || process.env.SUPABASE_NEW_SUPABASE_URL_2 || process.env.NEXT_PUBLIC_SUPABASE_NEW_SUPABASE_URL || process.env.SUPABASE_NEW_SUPABASE_URL;
    const url = newUrl || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = newUrl
      ? process.env.NEXT_PUBLIC_SUPABASE_NEW_SUPABASE_PUBLISHABLE_KEY_2 || process.env.NEXT_PUBLIC_SUPABASE_NEW_SUPABASE_ANON_KEY_2 || process.env.SUPABASE_NEW_SUPABASE_PUBLISHABLE_KEY_2 || process.env.SUPABASE_NEW_SUPABASE_ANON_KEY_2 || process.env.NEXT_PUBLIC_SUPABASE_NEW_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_NEW_SUPABASE_ANON_KEY
      : process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error("Private storage is not configured.");
    const storage = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }).storage;
    const { error: uploadError } = await storage.from("resumes").uploadToSignedUrl(signed.path, signed.token, file, {
      contentType: "application/pdf", cacheControl: "0",
    });
    if (uploadError) throw new Error(`Could not upload ${file.name} to private storage.`);
    return signed.path as string;
  }

  async function saveCandidate(resumeFile: File, extraFiles: File[], details: CandidateDetails) {
    const resumePath = await uploadFile(resumeFile);
    const extraPaths: string[] = [];
    for (const file of extraFiles) extraPaths.push(await uploadFile(file));
    return readJson(await fetch("/api/candidates/upload/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        resumePath,
        extraPaths,
        name: details.name,
        email: details.email,
        links: details.links,
        notes: details.notes,
      }),
    }));
  }

  async function submitSingle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setNotice("");
    if (!resume) {
      setError("Choose a resume PDF.");
      return;
    }
    try {
      validateFiles([resume, ...extras]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check the selected files.");
      return;
    }
    if (extras.length > 3) {
      setError("Add no more than 3 extra PDFs.");
      return;
    }
    const form = new FormData(event.currentTarget);
    const links = String(form.get("links") || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    if (links.length > 5) {
      setError("Add no more than 5 links, one per line.");
      return;
    }
    const details = {
      name: String(form.get("name") || "").trim(),
      email: String(form.get("email") || "").trim().toLowerCase(),
      links,
      notes: String(form.get("notes") || "").trim(),
    };
    setBusy(true);
    setProgress("Uploading and extracting profile…");
    try {
      await saveCandidate(resume, extras, details);
      setNotice("Candidate added. The compatibility review is queued.");
      setResume(null);
      setExtras([]);
      formRef.current?.reset();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The candidate could not be saved.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  function selectBulk(files: File[]) {
    setError("");
    setNotice("");
    if (files.length > 100) {
      setError("Select no more than 100 resume PDFs at once.");
      return;
    }
    try {
      validateFiles(files);
      setBulkFiles(files);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check the selected files.");
    }
  }

  function dropFiles(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    if (!busy) selectBulk(Array.from(event.dataTransfer.files));
  }

  async function submitBulk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setNotice("");
    if (!bulkFiles.length) {
      setError("Choose at least one resume PDF.");
      return;
    }
    setBusy(true);
    let added = 0;
    let skipped = 0;
    let failed = 0;
    for (const [index, file] of bulkFiles.entries()) {
      setProgress(`Processing ${index + 1} of ${bulkFiles.length}: ${file.name}`);
      try {
        await saveCandidate(file, [], { name: "", email: "", links: [], notes: "" });
        added += 1;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Upload failed.";
        if (message.toLowerCase().includes("already in the project")) skipped += 1;
        else failed += 1;
      }
    }
    setNotice(`${added} added · ${skipped} duplicate${skipped === 1 ? "" : "s"} skipped · ${failed} failed.`);
    setBulkFiles([]);
    setBusy(false);
    setProgress("");
    router.refresh();
  }

  return <section className="panel card form-stack import-panel" aria-labelledby="import-title">
    <div className="section-heading"><div>
      <h2 id="import-title"><FileUp size={19} aria-hidden="true" /> Add candidates</h2>
      <p className="muted">Private PDFs are analyzed to create an editable candidate profile.</p>
    </div><span className="pill"><ShieldCheck size={14} aria-hidden="true" /> Private storage</span></div>
    <div className="notice"><ShieldCheck size={17} aria-hidden="true" /> Resume, optional PDFs, links, and notes are used together for the profile and compatibility review.</div>
    <div className="upload-tabs" role="tablist" aria-label="Candidate upload type">
      <button type="button" role="tab" aria-selected={mode === "single"} className={mode === "single" ? "upload-tab is-active" : "upload-tab"}
        onClick={() => { setMode("single"); setError(""); setNotice(""); }}>Add one</button>
      <button type="button" role="tab" aria-selected={mode === "bulk"} className={mode === "bulk" ? "upload-tab is-active" : "upload-tab"}
        onClick={() => { setMode("bulk"); setError(""); setNotice(""); }}>Bulk upload</button>
    </div>

    {mode === "single" ? <form ref={formRef} className="form-stack" onSubmit={submitSingle} aria-busy={busy}>
      <div className="form-grid import-inputs">
        <label>Candidate name <span className="optional">Optional</span><input name="name" autoComplete="name" maxLength={100} /></label>
        <label>Candidate email <span className="optional">Optional</span><input name="email" type="email" autoComplete="email" maxLength={320} /></label>
      </div>
      <label className="candidate-file">Resume PDF <span className="required">Required</span>
        <input type="file" accept="application/pdf,.pdf" required disabled={busy} onChange={(event) => setResume(event.target.files?.[0] || null)} />
        <small>{resume?.name || "PDF only · maximum 5 MB"}</small>
      </label>
      <label>Links <span className="optional">Optional</span><textarea name="links" rows={2} maxLength={10250} placeholder="https://portfolio.example" />
        <small>Up to 5 HTTP or HTTPS links, one per line.</small></label>
      <label>Form answers or notes <span className="optional">Optional</span><textarea name="notes" rows={4} maxLength={10000} placeholder="Add application responses or reviewer context" /></label>
      <label>Additional PDFs <span className="optional">Optional · up to 3</span>
        <input type="file" accept="application/pdf,.pdf" multiple disabled={busy} onChange={(event) => {
          const selected = Array.from(event.target.files || []);
          try { validateFiles(selected); setExtras(selected.slice(0, 3)); setError(selected.length > 3 ? "Only the first 3 extra PDFs were selected." : ""); }
          catch (cause) { setExtras([]); setError(cause instanceof Error ? cause.message : "Check the selected files."); }
        }} />
        <small>{extras.length ? extras.map((file) => file.name).join(", ") : "Portfolio, cover letter, or other supporting PDFs · 5 MB each"}</small>
      </label>
      {error && <p role="alert" className="notice notice-error">{error}</p>}
      {notice && <p role="status" className="notice notice-success">{notice}</p>}
      <div><button className="button" type="submit" disabled={busy}>{busy ? <><LoaderCircle className="spin" size={16} aria-hidden="true" /> {progress}</> : <><UserPlus size={16} aria-hidden="true" /> Add candidate</>}</button></div>
    </form> : <form className="form-stack" onSubmit={submitBulk} aria-busy={busy}>
      <label className="bulk-drop" onDragOver={(event) => event.preventDefault()} onDrop={dropFiles}>
        <FileUp size={24} aria-hidden="true" />
        <strong>Drop resumes here or browse</strong>
        <span>Up to 100 PDF files · 5 MB each</span>
        <input type="file" accept="application/pdf,.pdf" multiple disabled={busy} onChange={(event) => selectBulk(Array.from(event.target.files || []))} />
      </label>
      {bulkFiles.length > 0 && <p className="muted" aria-live="polite">{bulkFiles.length} resume{bulkFiles.length === 1 ? "" : "s"} selected</p>}
      {busy && <p className="notice" role="status" aria-live="polite">{progress}</p>}
      {error && <p role="alert" className="notice notice-error">{error}</p>}
      {notice && <p role="status" className="notice notice-success">{notice}</p>}
      <div><button className="button" type="submit" disabled={busy || bulkFiles.length === 0}>{busy ? "Processing batch…" : "Upload resumes"}</button></div>
    </form>}
  </section>;
}
