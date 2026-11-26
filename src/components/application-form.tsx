"use client";

import { createClient } from "@supabase/supabase-js";
import { FileUp, LoaderCircle, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { submissionSchema } from "@/lib/schema";
import type { Application } from "@/lib/types";
import { Notice } from "./ui";

async function post(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json) throw new Error(json?.error || "The portal couldn’t save your submission. Try again.");
  return json;
}

export function ApplicationForm({ projectId, questions, previous, maxBytes }: {
  projectId: string; questions: string[]; previous: Pick<Application, "answers" | "links" | "submission_version"> | null;
  maxBytes: number;
}) {
  const router = useRouter();
  const ticket = useRef<{ file: File; path: string; created: number } | null>(null);
  const inProgress = useRef(false);
  const [filename, setFilename] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inProgress.current) return;
    setError("");
    const form = new FormData(event.currentTarget);
    const file = form.get("resume");
    if (!(file instanceof File) || !file.size || !/\.pdf$/i.test(file.name) || (file.type && file.type !== "application/pdf")) {
      setError("Choose a PDF file for your resume.");
      return;
    }
    if (file.size > maxBytes) {
      setError(`Choose a PDF up to ${maxBytes / 1048576} MB.`);
      return;
    }
    const values = submissionSchema.safeParse({
      projectId, path: "", expectedVersion: previous?.submission_version ?? 0, questions,
      links: String(form.get("links") || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      answers: form.getAll("answer"),
    });
    if (!values.success) {
      setError("Answer every question and enter up to five complete HTTP or HTTPS links.");
      return;
    }
    inProgress.current = true;
    try {
      const prior = ticket.current;
      const canReuse = prior && prior.file.name === file.name && prior.file.size === file.size
        && prior.file.lastModified === file.lastModified && Date.now() - prior.created < 19 * 60000;
      if (!canReuse) {
        setProgress("Uploading resume…");
        const { path, token } = await post("/api/uploads/start", { projectId, size: file.size, mediaType: "application/pdf" });
        const newStorageUrl = process.env.NEXT_PUBLIC_SUPABASE_NEW_SUPABASE_URL_2 || process.env.SUPABASE_NEW_SUPABASE_URL_2 || process.env.NEXT_PUBLIC_SUPABASE_NEW_SUPABASE_URL || process.env.SUPABASE_NEW_SUPABASE_URL;
        const storageUrl = newStorageUrl || process.env.NEXT_PUBLIC_SUPABASE_URL;
        const storageKey = newStorageUrl
          ? process.env.NEXT_PUBLIC_SUPABASE_NEW_SUPABASE_PUBLISHABLE_KEY_2 || process.env.NEXT_PUBLIC_SUPABASE_NEW_SUPABASE_ANON_KEY_2 || process.env.SUPABASE_NEW_SUPABASE_PUBLISHABLE_KEY_2 || process.env.SUPABASE_NEW_SUPABASE_ANON_KEY_2 || process.env.NEXT_PUBLIC_SUPABASE_NEW_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_NEW_SUPABASE_ANON_KEY
          : process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
        if (!storageUrl || !storageKey) throw new Error("Private storage is not configured.");
        const storage = createClient(storageUrl, storageKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        }).storage;
        const { error: uploadError } = await storage.from("resumes").uploadToSignedUrl(path, token, file, {
          contentType: "application/pdf", cacheControl: "0",
        });
        if (uploadError) throw new Error("The PDF couldn’t be uploaded. Check your connection and try again.");
        ticket.current = { file, path, created: Date.now() };
      }
      setProgress("Verifying and saving…");
      const { id } = await post("/api/uploads/submit", { ...values.data, path: ticket.current!.path });
      router.push(`/applications?submitted=${encodeURIComponent(id)}`);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Submission failed. Try again.");
      setProgress("");
      inProgress.current = false;
    }
  }

  return <form onSubmit={submit} className="form-stack" aria-busy={!!progress}>
    <fieldset className="form-stack" disabled={!!progress}>
      <label className="file-picker">
        <span className="icon-tile"><FileUp size={22} aria-hidden="true" /></span>
        <span><strong>{filename || "Choose a resume"}</strong><small>PDF, up to {maxBytes / 1048576} MB and 20 pages</small></span>
        <input name="resume" type="file" accept=".pdf,application/pdf" required onChange={(event) => {
          ticket.current = null;
          setFilename(event.target.files?.[0]?.name || "");
        }} />
      </label>
      <label>Portfolio or project links <span className="optional">Optional</span>
        <textarea name="links" rows={3} placeholder="https://example.com/portfolio" maxLength={10250}
          defaultValue={previous?.links.join("\n") || ""} />
        <small>Up to 5 links, one per line.</small>
      </label>
      {questions.map((question, i) => <label key={i}>{question}
        <textarea name="answer" rows={3} required maxLength={1000} defaultValue={previous?.answers[i] || ""} />
      </label>)}
    </fieldset>
    <Notice state={{ error }} />
    <div><button type="submit" className="button" disabled={!!progress}>
      {progress ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
      {progress || (previous ? "Replace application" : "Submit application")}
    </button></div>
    <small className="muted">The project reviewer can read your private resume. Screening may assist the review. A reviewer makes every decision.</small>
  </form>;
}
