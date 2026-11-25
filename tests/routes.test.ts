import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixturePdf } from "./fixtures/pdf";

vi.mock("server-only", () => ({}));
const { authSession, authSignIn, authSignOut, resolveReviewerProfile, serviceDb, redirect } = vi.hoisted(() => ({
  authSession: vi.fn(),
  authSignIn: vi.fn(),
  authSignOut: vi.fn(),
  resolveReviewerProfile: vi.fn(),
  serviceDb: vi.fn(),
  redirect: vi.fn((destination: string) => { throw new Error(`redirect:${destination}`); }),
}));
vi.mock("@/auth", () => ({ auth: authSession, signIn: authSignIn, signOut: authSignOut }));
vi.mock("@/lib/google-profile", () => ({ resolveReviewerProfile }));
vi.mock("@/lib/db", () => ({ serviceDb }));
vi.mock("next/navigation", () => ({ redirect }));

import { signInGoogle, signOut } from "@/app/actions";
import { POST as screen } from "@/app/api/internal/screen/route";
import { POST as internalImportStart } from "@/app/api/internal/import/start/route";
import { POST as internalImportComplete } from "@/app/api/internal/import/complete/route";
import { GET as callback } from "@/app/auth/callback/route";
import { requireSession, session } from "@/lib/auth";
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

function claim(role: "applicant" | "reviewer", email = "test@ashoka.edu.in", verified = true) {
  const filters = {
    eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({
      data: { id: studentId, email, name: "Synthetic", role, student_id: "TEST" },
    }),
  };
  const db = { from: vi.fn().mockReturnValue(filters), rpc: vi.fn() };
  authSession.mockResolvedValue({ user: { email, googleEmailVerified: verified } });
  resolveReviewerProfile.mockResolvedValue({ id: studentId, email, name: "Synthetic", role, student_id: "TEST" });
  serviceDb.mockReturnValue(db);
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
  vi.stubEnv("DEMO_MODE", "false");
  vi.stubEnv("AUTHORIZED_EMAIL_DOMAIN", "ashoka.edu.in");
  vi.stubEnv("MAX_RESUME_MB", "10");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://database.example.invalid");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-only-publishable");
});

describe("Google authentication guards", () => {
  it("accepts only verified campus Google sessions with a reviewer profile", async () => {
    authSession.mockResolvedValue(null);
    expect(await session()).toBeNull();
    expect(serviceDb).not.toHaveBeenCalled();

    claim("reviewer", "person@elsewhere.invalid");
    await expect(requireSession("reviewer")).rejects.toThrow("redirect:/sign-in");
    claim("reviewer", "reviewer@ashoka.edu.in", false);
    await expect(requireSession("reviewer")).rejects.toThrow("redirect:/sign-in");
    claim("applicant");
    await expect(requireSession("reviewer")).rejects.toThrow("redirect:/sign-in");

    const db = claim("reviewer");
    await expect(requireSession("reviewer")).resolves.toMatchObject({ profile: { id: studentId, role: "reviewer" } });
    expect(serviceDb).toHaveBeenCalled();
    expect(db).toBeDefined();
  });

  it("starts and ends a direct Google Auth.js session", async () => {
    await signInGoogle();
    await signOut();
    expect(authSignIn).toHaveBeenCalledWith("google", { redirectTo: "/reviewer" });
    expect(authSignOut).toHaveBeenCalledWith({ redirectTo: "/sign-in" });
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
    expect(result.headers.get("location")).toBe("https://demo.example.invalid/sign-in");
    expect((await screen(new Request(origin, { method: "POST", headers: { Authorization: `Bearer ${bearer}` } }))).status).toBe(404);
    expect(authSession).not.toHaveBeenCalled();
    expect(serviceDb).not.toHaveBeenCalled();
  });

  it("routes an authenticated applicant away from reviewer pages", async () => {
    claim("applicant");
    await expect(requireSession("reviewer")).rejects.toThrow("redirect:/sign-in");
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
    expect(rpc).toHaveBeenCalledWith("shortlist_csv_rows_for_reviewer", { p_reviewer: studentId, p_project: projectId });
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
  it("rejects the retired student upload endpoints", async () => {
    claim("applicant");
    expect((await start(post("/api/uploads/start", { projectId, size: 200, mediaType: "application/pdf" }))).status).toBe(403);
    expect((await submit(post("/api/uploads/submit", {}))).status).toBe(403);
    expect(serviceDb).not.toHaveBeenCalled();
  });

  it("does not issue resume links for another reviewer’s project", async () => {
    const db = claim("reviewer");
    const projectQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    db.from.mockReturnValue(projectQuery);
    const response = await openResume(new Request(origin), {
      params: Promise.resolve({ id: projectId, applicationId }),
    });
    expect(response.status).toBe(404);
    expect(projectQuery.eq).toHaveBeenNthCalledWith(2, "reviewer_id", studentId);
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
