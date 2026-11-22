"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import Papa from "papaparse";
import { FileCheck2, FileUp, ShieldCheck } from "lucide-react";
type ResumeFile = { key: string; name: string; file: File };
type Candidate = {
  name: string;
  email: string;
  studentId: string;
  interests: string[];
  resumeHint: string;
  file: ResumeFile | null;
  status: "ready" | "imported" | "failed";
  error?: string;
};

const MAX_ROWS = 100;
const normalized = (value: string) => value.toLocaleLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
const valueFor = (row: Record<string, string>, aliases: string[]) => {
  for (const alias of aliases) {
    const value = row[alias];
    if (value?.trim()) return value.trim();
  }
  return "";
};

export function InternalImport({ projectId, maxFileBytes }: { projectId: string; maxFileBytes: number }) {
  const router = useRouter();
  const [rows, setRows] = useState<Candidate[]>([]);
  const [availableFiles, setAvailableFiles] = useState<ResumeFile[]>([]);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [resumeFiles, setResumeFiles] = useState<File[]>([]);
  const [totalToImport, setTotalToImport] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const readyRows = useMemo(() => rows.filter((row) => row.file && row.status !== "imported"), [rows]);

  async function readResumeFiles(selected: File[]) {
    const collected: ResumeFile[] = [];
    for (const selectedFile of selected) {
      if (selectedFile.name.toLowerCase().endsWith(".zip")) {
        const archive = await JSZip.loadAsync(selectedFile);
        const pdfEntries = Object.values(archive.files).filter((entry) => !entry.dir && entry.name.toLowerCase().endsWith(".pdf"));
        if (pdfEntries.length > MAX_ROWS) throw new Error(`A ZIP can contain at most ${MAX_ROWS} PDF resumes.`);
        let declaredTotal = 0;
        for (const entry of pdfEntries) {
          const size = (entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
          declaredTotal += size;
          if (size > maxFileBytes || declaredTotal > 250 * 1024 * 1024) {
            throw new Error("The ZIP contains a PDF or total uncompressed size above the import limits.");
          }
        }
        for (const entry of pdfEntries) {
          const blob = await entry.async("blob");
          if (blob.size > maxFileBytes) throw new Error(`${entry.name.split(/[\\/]/).pop() || "A PDF"} exceeds the configured size limit.`);
          const name = entry.name.split(/[\\/]/).pop() || "resume.pdf";
          collected.push({ key: entry.name, name, file: new File([blob], name, { type: "application/pdf" }) });
        }
      } else if (selectedFile.name.toLowerCase().endsWith(".pdf")) {
        if (selectedFile.size > maxFileBytes) throw new Error(`${selectedFile.name} exceeds the configured PDF size limit.`);
        collected.push({ key: selectedFile.name, name: selectedFile.name, file: selectedFile });
      }
    }
    if (!collected.length) throw new Error("Choose PDF resumes or a ZIP archive containing PDFs.");
    if (collected.length > MAX_ROWS) throw new Error(`Import at most ${MAX_ROWS} applicants at a time.`);
    return collected;
  }

  async function prepareImport(csvFile: File | null, resumeSelection: File[]) {
    setError("");
    setNotice("");
    setRows([]);
    setAvailableFiles([]);
    if (!csvFile || !resumeSelection.length) {
      setError("Choose a CSV file and PDF resumes or a ZIP archive.");
      return;
    }
    try {
      const [csvText, files] = await Promise.all([csvFile.text(), readResumeFiles(resumeSelection)]);
      const parsed = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: "greedy", transformHeader: (header) => header.trim().toLowerCase().replace(/[\s-]+/g, "_") });
      setAvailableFiles(files);
      if (parsed.errors.length) throw new Error("The CSV has a formatting issue. Check the headers and quoted fields, then try again.");
      if (!parsed.data.length || parsed.data.length > MAX_ROWS) throw new Error(`The CSV must contain between 1 and ${MAX_ROWS} applicants.`);

      const candidates = parsed.data.map((raw) => {
        const name = valueFor(raw, ["name", "full_name", "applicant_name"]);
        const email = valueFor(raw, ["email", "email_address", "applicant_email"]).toLowerCase();
        const studentId = valueFor(raw, ["student_id", "studentid", "id"]);
        const interests = valueFor(raw, ["interests", "interest_tags", "areas_of_interest"])
          .split(/[;,|]/).map((item) => item.trim()).filter(Boolean).slice(0, 20);
        const resumeHint = valueFor(raw, ["resume", "resume_file", "filename", "file"]);
        return { name, email, studentId, interests, resumeHint, file: null, status: "ready" as const };
      });
      const emails = new Set<string>();
      for (const candidate of candidates) {
        if (!candidate.name || candidate.name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate.email) ||
          (candidate.studentId && !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/.test(candidate.studentId))) {
          throw new Error("Every row needs a valid name and email address. Optional columns: valid student_id, interests, resume_file.");
        }
        if (emails.has(candidate.email)) throw new Error(`The CSV contains duplicate email ${candidate.email}.`);
        emails.add(candidate.email);
      }

      const used = new Set<string>();
      const matched = candidates.map((candidate) => {
        const keys = [candidate.resumeHint, candidate.email, candidate.email.split("@")[0], candidate.studentId, candidate.name]
          .map((value) => normalized(value.replace(/\.[^.]+$/, ""))).filter((value) => value.length >= 3);
        const matches = files.filter((file) => {
          if (used.has(file.key)) return false;
          const base = normalized(file.name.replace(/\.pdf$/i, ""));
          return keys.some((key) => base === key || (key.length >= 5 && base.includes(key)) || (base.length >= 5 && key.includes(base)));
        });
        if (matches.length === 1) {
          used.add(matches[0].key);
          return { ...candidate, file: matches[0] };
        }
        return candidate;
      });
      setRows(matched);
      const unmatched = matched.filter((row) => !row.file).length;
      setNotice(`${matched.length} CSV rows loaded. ${matched.length - unmatched} resumes matched${unmatched ? `; ${unmatched} need a clearer filename match` : ""}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The selected files could not be read.");
    }
  }

  async function importApplicants() {
    if (!readyRows.length || busy) return;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) {
      setError("Private storage is not configured for this environment.");
      return;
    }
    const storage = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const batch = readyRows;
    setBusy(true);
    setProgress(0);
    setTotalToImport(batch.length);
    setError("");
    let completed = 0;
    let importedCount = 0;
    for (const candidate of batch) {
      try {
        const start = await fetch("/api/internal/import/start", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, size: candidate.file!.file.size, mediaType: "application/pdf", name: candidate.name,
            email: candidate.email, studentId: candidate.studentId, interests: candidate.interests }),
        });
        const signed = await start.json();
        if (!start.ok) throw new Error(signed.error || "Could not prepare private upload.");
        const uploaded = await storage.storage.from("resumes").uploadToSignedUrl(signed.path, signed.token, candidate.file!.file, {
          contentType: "application/pdf", upsert: false,
        });
        if (uploaded.error) throw new Error("The PDF could not be uploaded to private storage.");
        const finish = await fetch("/api/internal/import/complete", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, path: signed.path, name: candidate.name, email: candidate.email,
            studentId: candidate.studentId, interests: candidate.interests }),
        });
        const saved = await finish.json();
        if (!finish.ok) throw new Error(saved.error || "Could not save the applicant.");
        importedCount += 1;
        setRows((current) => current.map((row) => row.email === candidate.email ? { ...row, status: "imported" } : row));
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Import failed.";
        setRows((current) => current.map((row) => row.email === candidate.email ? { ...row, status: "failed", error: message } : row));
      }
      completed += 1;
      setProgress(completed);
    }
    setBusy(false);
    setNotice(`${completed} applicants processed. Successfully imported ${importedCount}. Screening will continue in the background.`);
    router.refresh();
  }

  return <section className="panel card form-stack import-panel" aria-labelledby="import-title">
    <div className="section-heading"><div><h2 id="import-title"><FileUp size={19} aria-hidden="true" /> Import applicants</h2>
      <p className="muted">Upload a roster CSV and individual PDFs or a ZIP. Match each resume by filename, name, or email.</p></div>
      <span className="pill"><ShieldCheck size={14} aria-hidden="true" /> Private storage</span>
    </div>
    <div className="notice"><ShieldCheck size={17} aria-hidden="true" /> Resume text is extracted and redacted before approved Gemini processing; PDFs are never sent directly. Redaction is not anonymization. Free-tier processing is limited to synthetic test resumes. Student IDs are never sent to the model.</div>
    <div className="form-grid import-inputs">
      <label>Applicant roster (CSV)<input id="roster-csv-input" type="file" accept=".csv,text/csv" onChange={(event) => {
        const selected = event.target.files?.[0] || null;
        setCsvFile(selected);
        if (selected && resumeFiles.length) void prepareImport(selected, resumeFiles);
      }} />
        <small>Required columns: name, email. Optional: student_id, interests, resume_file.</small></label>
      <label>Resumes (PDF or ZIP)<input id="resume-archive-input" type="file" accept=".pdf,.zip,application/pdf,application/zip" multiple
        onChange={(event) => {
          const selected = Array.from(event.target.files || []);
          setResumeFiles(selected);
          if (csvFile) void prepareImport(csvFile, selected);
        }} />
        <small>Up to {MAX_ROWS} applicants; each PDF must fit the configured size limit.</small></label>
    </div>
    {notice && <p role="status" className="muted">{notice}</p>}
    {error && <p role="alert" className="notice notice-error">{error}</p>}
    {!!rows.length && <>
      <div className="panel table-scroll"><table><caption className="sr-only">Applicants ready for import</caption>
        <thead><tr><th>Applicant</th><th>Resume file</th><th>Interests</th><th>Status</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.email}>
          <th scope="row">{row.name}<span className="table-subtitle">{row.email}</span></th>
          <td><select aria-label={`Resume for ${row.name}`} value={row.file?.key || ""} disabled={busy || row.status === "imported"}
            onChange={(event) => setRows((current) => current.map((candidate) => candidate.email === row.email
              ? { ...candidate, file: availableFiles.find((file) => file.key === event.target.value) || null, status: "ready", error: undefined }
              : candidate))}>
            <option value="">Choose a resume</option>
            {availableFiles.filter((file) => !rows.some((candidate) => candidate.email !== row.email && candidate.file?.key === file.key))
              .map((file) => <option key={file.key} value={file.key}>{file.name}</option>)}
          </select></td>
          <td>{row.interests.length ? row.interests.join(", ") : <span className="muted">Not provided</span>}</td>
          <td>{row.status === "imported" ? <span className="pill pill-open"><FileCheck2 size={14} /> Imported</span>
            : row.status === "failed" ? <span className="muted">{row.error}</span> : row.file ? "Ready" : "Needs match"}</td>
        </tr>)}</tbody>
      </table></div>
      {busy && <div className="import-progress" role="status" aria-live="polite">
        <progress max={totalToImport} value={progress} aria-label="Import progress" />
        <span>Uploading and validating resume {progress} of {totalToImport}</span>
      </div>}
      <button className="button" type="button" disabled={busy || !readyRows.length} onClick={() => void importApplicants()}>
        {busy ? "Importing…" : `Import ${readyRows.length} matched ${readyRows.length === 1 ? "applicant" : "applicants"}`}
      </button>
    </>}
  </section>;
}
