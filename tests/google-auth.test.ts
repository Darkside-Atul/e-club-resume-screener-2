import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { serviceDb } = vi.hoisted(() => ({ serviceDb: vi.fn() }));
vi.mock("@/lib/db", () => ({ serviceDb }));

import { authorizeGoogleReviewer, resolveReviewerProfile } from "@/lib/google-profile";

function profileLookup(data: unknown, error: unknown = null) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  serviceDb.mockReturnValue({ from: vi.fn().mockReturnValue(query) });
  return query;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTHORIZED_EMAIL_DOMAIN", "ashoka.edu.in");
});

describe("direct Google reviewer authorization", () => {
  it("rejects unverified and non-campus Google identities before database lookup", async () => {
    expect(await authorizeGoogleReviewer({ email: "reviewer@ashoka.edu.in", email_verified: false })).toBe(false);
    expect(await authorizeGoogleReviewer({ email: "reviewer@example.com", email_verified: true })).toBe(false);
    expect(serviceDb).not.toHaveBeenCalled();
  });

  it("allows only a Google-verified campus email with a pre-provisioned reviewer profile", async () => {
    const query = profileLookup({
      id: "50a13eaa-0c00-4d53-a828-1faac38be441",
      email: "reviewer@ashoka.edu.in",
      name: "Reviewer",
      student_id: null,
      role: "reviewer",
    });

    expect(await authorizeGoogleReviewer({ email: " Reviewer@Ashoka.edu.in ", email_verified: true })).toBe(true);
    expect(query.eq).toHaveBeenNthCalledWith(1, "email", "reviewer@ashoka.edu.in");
    expect(query.eq).toHaveBeenNthCalledWith(2, "role", "reviewer");
  });

  it("fails closed when no reviewer profile exists or the profile query fails", async () => {
    profileLookup(null);
    expect(await resolveReviewerProfile("missing@ashoka.edu.in")).toBeNull();

    profileLookup(null, { message: "database unavailable" });
    expect(await authorizeGoogleReviewer({ email: "reviewer@ashoka.edu.in", email_verified: true })).toBe(false);
  });
});
