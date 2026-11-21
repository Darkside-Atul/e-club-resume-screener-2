import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixturePdf } from "./fixtures/pdf";

vi.mock("server-only", () => ({}));
const { userDb, serviceDb, redirect } = vi.hoisted(() => ({
  userDb: vi.fn(),
  serviceDb: vi.fn(),
  redirect: vi.fn((destination: string) => { throw new Error(`redirect:${destination}`); }),
}));
vi.mock("@/lib/db", () => ({ userDb, serviceDb }));
vi.mock("next/navigation", () => ({ redirect }));

import { signInPassword, signUpPassword } from "@/app/actions";
import { POST as screen } from "@/app/api/internal/screen/route";
import { GET as callback } from "@/app/auth/callback/route";
import { requireSession } from "@/lib/auth";
import { POST as start } from "@/app/api/uploads/start/route";
import { POST as submit } from "@/app/api/uploads/submit/route";
import { GET as exportShortlist } from "@/app/(workspace)/reviewer/[id]/export/route";
import { GET as openResume } from "@/app/(workspace)/reviewer/[id]/applicants/[applicationId]/resume/route";

const projectId = randomUUID();
const applicationId = randomUUID();
const studentId = randomUUID();
const origin = "http://localhost:3000";
const path = `${studentId}/${projectId}/${randomUUID()}.pdf`;

function claim(role: "applicant" | "reviewer", email = "test@ashoka.edu.in", confirmed = true) {
  const filters = {
    eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({
      data: { id: studentId, email, name: "Synthetic", role, student_id: "TEST" },
    }),
  };
  const db = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: studentId, email, email_confirmed_at: confirmed ? "confirmed" : null } } }) },
    from: vi.fn().mockReturnValue(filters),
    rpc: vi.fn(),
  };
  userDb.mockResolvedValue(db);
  return db;
}

function post(url: string, body: unknown, requestOrigin = origin) {
  return new Request(`${origin}${url}`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: requestOrigin },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  vi.stubEnv("APP_URL", origin);
  vi.stubEnv("DEMO_MODE", "false");
  vi.stubEnv("AUTHORIZED_EMAIL_DOMAIN", "ashoka.edu.in");
  vi.stubEnv("MAX_RESUME_MB", "10");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://database.example.invalid");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-only-publishable");
});

describe("server guards", () => {
  it("restricts password sign-in and registration to campus email addresses", async () => {
    const signInForm = new FormData();
    signInForm.set("email", "test@example.com");
    signInForm.set("password", "correct-horse-battery");
    expect(await signInPassword({}, signInForm)).toEqual({ error: "Enter a valid @ashoka.edu.in email address." });

    const signUpForm = new FormData();
    signUpForm.set("email", "test@ashoka.edu.in");
    signUpForm.set("password", "short");
    signUpForm.set("confirm_password", "short");
    expect(await signUpPassword({}, signUpForm)).toEqual({ error: "Use a password with at least 8 characters." });
    expect(userDb).not.toHaveBeenCalled();
  });

  it("signs in with a password and routes by the server-owned profile role", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { role: "reviewer" }, error: null });
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle };
    const signInWithPassword = vi.fn().mockResolvedValue({
      data: { user: { id: studentId, email: "test@ashoka.edu.in", email_confirmed_at: "confirmed" } }, error: null,
    });
    userDb.mockResolvedValue({ auth: { signInWithPassword, signOut: vi.fn() }, from: vi.fn().mockReturnValue(query) });
    const form = new FormData();
    form.set("email", "test@ashoka.edu.in");
    form.set("password", "correct-horse-battery");
    await expect(signInPassword({}, form)).rejects.toThrow("redirect:/reviewer");
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "test@ashoka.edu.in", password: "correct-horse-battery" });
  });

  it("creates and signs in campus accounts without email-link verification", async () => {
    const signUp = vi.fn().mockResolvedValue({
      data: { session: null, user: { id: studentId, email: "test@ashoka.edu.in" } }, error: null,
    });
    const signInWithPassword = vi.fn().mockResolvedValue({ error: null });
    const adminConfirm = vi.fn().mockResolvedValue({ error: null });
    userDb.mockResolvedValue({ auth: { signUp, signInWithPassword } });
    serviceDb.mockReturnValue({ auth: { admin: { updateUserById: adminConfirm } } });
    const form = new FormData();
    form.set("email", "test@ashoka.edu.in");
    form.set("password", "correct-horse-battery");
    form.set("confirm_password", "correct-horse-battery");
    await expect(signUpPassword({}, form)).rejects.toThrow("redirect:/projects");
    expect(signUp).toHaveBeenCalledWith({ email: "test@ashoka.edu.in", password: "correct-horse-battery" });
    expect(adminConfirm).toHaveBeenCalledWith(studentId, { email_confirm: true });
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "test@ashoka.edu.in", password: "correct-horse-battery" });
  });

  it("keeps demo requests away from authentication, storage, export and the worker even with credentials configured", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const bearer = "synthetic-test-worker-secret".repeat(2);
    vi.stubEnv("CRON_SECRET", bearer);
    const payload = { projectId, size: 200, mediaType: "application/pdf" };
    expect((await start(post("/api/uploads/start", payload))).status).toBe(403);
    expect((await submit(post("/api/uploads/submit", {}))).status).toBe(403);
    expect((await exportShortlist(new Request(origin), { params: Promise.resolve({ id: projectId }) })).status).toBe(403);
    const result = await callback(new Request("https://demo.example.invalid/auth/callback"));
    expect(result.headers.get("location")).toBe("https://demo.example.invalid/demo");
    expect((await screen(new Request(origin, { method: "POST", headers: { Authorization: `Bearer ${bearer}` } }))).status).toBe(404);
    expect(userDb).not.toHaveBeenCalled();
    expect(serviceDb).not.toHaveBeenCalled();
  });

  it("routes an authenticated applicant away from reviewer pages", async () => {
    claim("applicant");
    await expect(requireSession("reviewer")).rejects.toThrow("redirect:/projects");
  });

  it("requires a confirmed campus email even if a profile exists", async () => {
    claim("reviewer", "person@elsewhere.invalid");
    await expect(requireSession("reviewer")).rejects.toThrow("redirect:/sign-in");
    claim("reviewer", "test@ashoka.edu.in", false);
    await expect(requireSession("reviewer")).rejects.toThrow("redirect:/sign-in");
  });

  it("rejects applicants from CSV and resume routes without using privileged storage", async () => {
    claim("applicant");
    expect((await exportShortlist(new Request(origin), { params: Promise.resolve({ id: projectId }) })).status).toBe(403);
    expect((await openResume(new Request(origin), { params: Promise.resolve({ id: projectId, applicationId }) })).status).toBe(403);
    expect(serviceDb).not.toHaveBeenCalled();
  });

  it("returns a genuine Excel-compatible attachment for a successful authorized export", async () => {
    const { rpc } = claim("reviewer");
    const range = vi.fn().mockResolvedValue({ data: [{ name: "Synthetic", note: "=formula" }] });
    rpc.mockReturnValue({ range });
    const response = await exportShortlist(new Request(origin), { params: Promise.resolve({ id: projectId }) });
    expect(rpc).toHaveBeenCalledWith("shortlist_csv_rows", { p_project: projectId });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(await response.text()).toContain('"\'=formula"');
  });
});

describe("upload API", () => {
  it("rejects cross-origin requests, non-PDF MIME types and oversized uploads before issuing a signed upload", async () => {
    claim("applicant");
    const body = { projectId, size: 200, mediaType: "application/pdf" };
    expect((await start(post("/api/uploads/start", body, "https://other.example.invalid"))).status).toBe(403);
    expect((await start(post("/api/uploads/start", { ...body, mediaType: "image/png" }))).status).toBe(400);
    expect((await start(post("/api/uploads/start", { ...body, size: 10485761 }))).status).toBe(413);
    expect(serviceDb).not.toHaveBeenCalled();
  });

  it("issues a signed non-upserting upload for the authenticated applicant", async () => {
    claim("applicant");
    const createSignedUploadUrl = vi.fn().mockResolvedValue({ data: { token: "test-only-token" } });
    const rpc = vi.fn().mockResolvedValue({ data: path });
    serviceDb.mockReturnValue({ rpc, storage: { from: () => ({ createSignedUploadUrl }) } });
    const response = await start(post("/api/uploads/start", { projectId, size: 200, mediaType: "application/pdf" }));
    expect(await response.json()).toEqual({ path, token: "test-only-token" });
    expect(rpc).toHaveBeenCalledWith("begin_resume_upload", { p_user: studentId, p_project: projectId });
    expect(createSignedUploadUrl).toHaveBeenCalledWith(path, { upsert: false });
  });

  function storageResponse(bytes: Uint8Array | string) {
    claim("applicant");
    const rpc = vi.fn().mockResolvedValue({ data: applicationId });
    const ticket = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { created_at: new Date().toISOString(), finalized_at: null } }),
    };
    const bucket = { createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: "https://storage.example.invalid/signed" } }) };
    serviceDb.mockReturnValue({ rpc, from: () => ticket, storage: { from: () => bucket } });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () =>
      new Response(typeof bytes === "string" ? bytes : Uint8Array.from(bytes), { headers: { "content-type": "application/pdf" } })));
    return rpc;
  }

  const submitted = { projectId, path, expectedVersion: 0, questions: [], answers: [], links: [] };

  it("validates real PDF bytes before persisting the application", async () => {
    const rpc = storageResponse(fixturePdf());
    const response = await submit(post("/api/uploads/submit", submitted));
    expect(await response.json()).toEqual({ id: applicationId });
    expect(rpc).toHaveBeenCalledWith("submit_resume", {
      p_user: studentId, p_project: projectId, p_path: path, p_expected_version: 0,
      p_question_snapshot: [], p_answers: [], p_links: [],
    });
  });

  it("rejects fake PDF bytes despite a PDF content type and never commits the application", async () => {
    const rpc = storageResponse("%PDF-1.7\nrogue data\n%%EOF\n");
    expect((await submit(post("/api/uploads/submit", submitted))).status).toBe(415);
    expect(rpc).not.toHaveBeenCalled();
  });
});
