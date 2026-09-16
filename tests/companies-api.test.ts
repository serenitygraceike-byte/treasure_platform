import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/rbac", () => ({ isOrgManager: vi.fn(), getOrgMembership: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn() },
  },
}));

import { getCurrentUser } from "@/lib/session";
import { isOrgManager } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/v1/companies/route";

function req(body: unknown) {
  return new Request("http://localhost/api/v1/companies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  legalName: "New Co SA",
  countryCode: "gr",
  baseCurrency: "eur",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/v1/companies", () => {
  it("rejects an unauthenticated caller", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
    const res = await POST(req(validBody));
    expect(res.status).toBe(401);
  });

  it("rejects a caller who is not an org manager", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(isOrgManager).mockResolvedValueOnce(false);
    const res = await POST(req(validBody));
    expect(res.status).toBe(403);
    expect(prisma.company.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid body", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    const res = await POST(req({ organizationId: "not-a-uuid" }));
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate legal name within the organization", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(isOrgManager).mockResolvedValueOnce(true);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce({ id: "existing" } as never);
    const res = await POST(req(validBody));
    expect(res.status).toBe(409);
    expect(prisma.company.create).not.toHaveBeenCalled();
  });

  it("creates the company and logs an audit event", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(isOrgManager).mockResolvedValueOnce(true);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.company.create).mockResolvedValueOnce({ id: "new-co", ...validBody } as never);

    const res = await POST(req(validBody));

    expect(res.status).toBe(201);
    expect(prisma.company.create).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "company.create", objectId: "new-co" })
    );
  });
});
