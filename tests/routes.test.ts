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

import { signInGoogle, signInPassword, signUpPassword } from "@/app/actions";
import { POST as screen } from "@/app/api/internal/screen/route";
import { POST as internalImportStart } from "@/app/api/internal/import/start/route";
import { POST as internalImportComplete } from "@/app/api/internal/import/complete/route";
import { GET as callback } from "@/app/auth/callback/route";
import { requireSession } from "@/lib/auth";
import { sameOrigin } from "@/lib/http";
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
  it("restricts applicant sign-in and registration to campus email addresses", async () => {
    const signInForm = new FormData();
    signInForm.set("email", "test@example.com");
    signInForm.set("password", "correct-horse-battery");
    signInForm.set("role", "applicant");
    expect(await signInPassword({}, signInForm)).toEqual({ error: "Enter a valid @ashoka.edu.in email address." });

    const signUpForm = new FormData();
    signUpForm.set("email", "test@ashoka.edu.in");
    signUpForm.set("password", "short");
    signUpForm.set("role", "reviewer");
    expect(await signUpPassword({}, signUpForm)).toEqual({ error: "Choose a password between 8 and 72 characters." });
    expect(userDb).not.toHaveBeenCalled();
  });

  it("creates applicant accounts through Supabase email confirmation", async () => {
    const signUp = vi.fn().mockResolvedValue({ data: { user: { id: studentId }, session: null }, error: null });
    userDb.mockResolvedValue({ auth: { signUp } });
    const form = new FormData();
    form.set("email", "Applicant@ashoka.edu.in");
    form.set("password", "a-secure-test-password");
    form.set("role", "reviewer");

    await expect(signUpPassword({}, form)).resolves.toEqual({
      success: "If this campus email can be registered, we’ve sent a confirmation link. Check your inbox to continue.",
    });
    expect(signUp).toHaveBeenCalledWith({
      email: "applicant@ashoka.edu.in",
      password: "a-secure-test-password",
      options: { emailRedirectTo: `${origin}/auth/callback` },
    });
  });

  it("refuses Google OAuth for reviewer accounts", async () => {
    vi.stubEnv("GOOGLE_OAUTH_ENABLED", "true");
    const form = new FormData();
    form.set("role", "reviewer");
    await expect(signInGoogle(form)).rejects.toThrow("redirect:/sign-in?error=unavailable");
    expect(userDb).not.toHaveBeenCalled();
  });

  it("sends applicant Google OAuth through the v0 Supabase redirect proxy", async () => {
    vi.stubEnv("GOOGLE_OAUTH_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL", "https://redirect-proxy.example/auth/callback");
    const signInWithOAuth = vi.fn().mockResolvedValue({ data: { url: "https://accounts.google.com/oauth" }, error: null });
    userDb.mockResolvedValue({ auth: { signInWithOAuth } });
    const form = new FormData();
    form.set("role", "applicant");

    await expect(signInGoogle(form)).rejects.toThrow("redirect:https://accounts.google.com/oauth");
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://redirect-proxy.example/auth/callback",
        queryParams: { hd: "ashoka.edu.in", prompt: "select_account" },
      },
    });
  });

  it("allows external email for reviewer sign-in while routing by the server-owned role", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { role: "reviewer" }, error: null });
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle };
    const signInWithPassword = vi.fn().mockResolvedValue({
      data: { user: { id: studentId, email: "reviewer@example.com", email_confirmed_at: "confirmed" } }, error: null,
    });
    userDb.mockResolvedValue({ auth: { signInWithPassword, signOut: vi.fn() }, from: vi.fn().mockReturnValue(query) });
    const form = new FormData();
    form.set("email", "reviewer@example.com");
    form.set("password", "correct-horse-battery");
    form.set("role", "reviewer");
    await expect(signInPassword({}, form)).rejects.toThrow("redirect:/reviewer");
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "reviewer@example.com", password: "correct-horse-battery" });
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

  it("allows external confirmed reviewers but keeps applicants campus-only", async () => {
    claim("reviewer", "person@elsewhere.invalid");
    await expect(requireSession("reviewer")).resolves.toMatchObject({ profile: { role: "reviewer" } });
    claim("applicant", "person@elsewhere.invalid");
    await expect(requireSession("applicant")).rejects.toThrow("redirect:/applicant/login");
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

describe("same-origin request guard", () => {
  it("accepts the current deployment origin without relying on a hardcoded app URL", () => {
    const request = new Request("https://e-club-resume-screener.vercel.app/api/internal/import/start", {
      method: "POST",
      headers: { Origin: "https://e-club-resume-screener.vercel.app" },
    });
    expect(sameOrigin(request)).toBe(true);

    const crossOrigin = new Request("https://e-club-resume-screener.vercel.app/api/internal/import/start", {
      method: "POST",
      headers: { Origin: "https://attacker.example" },
    });
    expect(sameOrigin(crossOrigin)).toBe(false);
    expect(sameOrigin(new Request("https://e-club-resume-screener.vercel.app/api/internal/import/start", { method: "POST" }))).toBe(false);
  });
});

describe("reviewer-only resume import", () => {
  it("rejects reviewers from the applicant upload endpoints", async () => {
    claim("reviewer");
    expect((await start(post("/api/uploads/start", { projectId, size: 200, mediaType: "application/pdf" }))).status).toBe(403);
    expect((await submit(post("/api/uploads/submit", {}))).status).toBe(403);
    expect(serviceDb).not.toHaveBeenCalled();
  });

  it("creates a private, non-upserting ticket for an authorized reviewer", async () => {
    claim("reviewer");
    const createSignedUploadUrl = vi.fn().mockResolvedValue({ data: { token: "test-only-token" } });
    const rpc = vi.fn().mockResolvedValue({ data: path });
    serviceDb.mockReturnValue({ rpc, storage: { from: () => ({ createSignedUploadUrl }) } });
    const response = await internalImportStart(post("/api/internal/import/start", {
      projectId, size: 200, mediaType: "application/pdf", name: "Imported Applicant",
      email: "candidate@example.edu", studentId: "A-123", interests: ["Robotics"],
    }));
    expect(await response.json()).toEqual({ path, token: "test-only-token" });
    expect(rpc).toHaveBeenCalledWith("begin_internal_resume_upload", { p_reviewer: studentId, p_project: projectId });
    expect(createSignedUploadUrl).toHaveBeenCalledWith(path, { upsert: false });
  });

  it("validates a PDF before creating an authless imported applicant", async () => {
    claim("reviewer");
    const rpc = vi.fn().mockResolvedValue({ data: applicationId, error: null });
    const ticket = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { created_at: new Date().toISOString(), finalized_at: null }, error: null }),
    };
    const bucket = { createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: "https://storage.example.invalid/signed" }, error: null }) };
    serviceDb.mockReturnValue({ rpc, from: () => ticket, storage: { from: () => bucket } });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () =>
      new Response(Uint8Array.from(fixturePdf()), { headers: { "content-type": "application/pdf" } })));
    const response = await internalImportComplete(post("/api/internal/import/complete", {
      projectId, path, name: "Imported Applicant", email: "candidate@example.edu", studentId: "A-123", interests: ["Robotics"],
    }));
    expect(await response.json()).toEqual({ id: applicationId });
    expect(rpc).toHaveBeenCalledWith("import_applicant", {
      p_reviewer: studentId, p_project: projectId, p_path: path, p_name: "Imported Applicant",
      p_email: "candidate@example.edu", p_student_id: "A-123", p_interests: ["Robotics"],
    });
  });
});
