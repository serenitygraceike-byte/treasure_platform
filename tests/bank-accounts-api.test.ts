import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/rbac", () => ({ canAccessCompany: vi.fn(), canManageTreasury: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/treasury/bank-accounts", () => ({
  listBankAccounts: vi.fn(),
  createBankAccount: vi.fn(),
  getBankAccount: vi.fn(),
  updateBankAccount: vi.fn(),
}));

import { getCurrentUser } from "@/lib/session";
import { canAccessCompany, canManageTreasury } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import {
  createBankAccount,
  listBankAccounts,
  getBankAccount,
  updateBankAccount,
} from "@/lib/treasury/bank-accounts";
import { GET, POST } from "@/app/api/v1/companies/[id]/bank-accounts/route";
import { PATCH } from "@/app/api/v1/bank-accounts/[id]/route";

const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const company = { id: COMPANY_ID, organizationId: "org1" };

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function getReq() {
  return new Request(`http://localhost/api/v1/companies/${COMPANY_ID}/bank-accounts`);
}

function postReq(body: unknown) {
  return new Request(`http://localhost/api/v1/companies/${COMPANY_ID}/bank-accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchReq(body: unknown) {
  return new Request("http://localhost/api/v1/bank-accounts/ba1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validCreateBody = {
  name: "Main Account",
  bankName: "Piraeus Bank",
  currency: "EUR",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/v1/companies/:id/bank-accounts", () => {
  it("rejects an unauthenticated caller", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
    const res = await GET(getReq(), params(COMPANY_ID));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the company doesn't exist", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(null);
    const res = await GET(getReq(), params(COMPANY_ID));
    expect(res.status).toBe(404);
  });

  it("returns 404 (not 403) when the caller lacks company access", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canAccessCompany).mockResolvedValueOnce(false);
    const res = await GET(getReq(), params(COMPANY_ID));
    expect(res.status).toBe(404);
  });

  it("lists bank accounts for a member", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canAccessCompany).mockResolvedValueOnce(true);
    vi.mocked(listBankAccounts).mockResolvedValueOnce([{ id: "ba1" }] as never);

    const res = await GET(getReq(), params(COMPANY_ID));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "ba1" }]);
  });
});

describe("POST /api/v1/companies/:id/bank-accounts", () => {
  it("rejects an unauthenticated caller", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
    const res = await POST(postReq(validCreateBody), params(COMPANY_ID));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the caller can't even see the company", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canAccessCompany).mockResolvedValueOnce(false);
    const res = await POST(postReq(validCreateBody), params(COMPANY_ID));
    expect(res.status).toBe(404);
  });

  it("rejects a viewer who can see the company but can't manage treasury", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canAccessCompany).mockResolvedValueOnce(true);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(false);

    const res = await POST(postReq(validCreateBody), params(COMPANY_ID));

    expect(res.status).toBe(403);
    expect(createBankAccount).not.toHaveBeenCalled();
  });

  it("rejects an unsupported currency", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canAccessCompany).mockResolvedValueOnce(true);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(true);

    const res = await POST(postReq({ ...validCreateBody, currency: "GBP" }), params(COMPANY_ID));

    expect(res.status).toBe(400);
    expect(createBankAccount).not.toHaveBeenCalled();
  });

  it("creates the bank account and logs an audit event", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canAccessCompany).mockResolvedValueOnce(true);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(true);
    vi.mocked(createBankAccount).mockResolvedValueOnce({ id: "ba1", ...validCreateBody } as never);

    const res = await POST(postReq(validCreateBody), params(COMPANY_ID));

    expect(res.status).toBe(201);
    expect(createBankAccount).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org1", companyId: COMPANY_ID, ...validCreateBody })
    );
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "bank_account.create", objectId: "ba1" })
    );
  });
});

describe("PATCH /api/v1/bank-accounts/:id", () => {
  it("rejects an unauthenticated caller", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
    const res = await PATCH(patchReq({ name: "New name" }), params("ba1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the bank account doesn't exist", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(getBankAccount).mockResolvedValueOnce(null);
    const res = await PATCH(patchReq({ name: "New name" }), params("ba1"));
    expect(res.status).toBe(404);
  });

  it("rejects a caller who can't manage treasury", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(getBankAccount).mockResolvedValueOnce({ id: "ba1", companyId: COMPANY_ID } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(false);

    const res = await PATCH(patchReq({ name: "New name" }), params("ba1"));

    expect(res.status).toBe(403);
    expect(updateBankAccount).not.toHaveBeenCalled();
  });

  it("rejects an empty update body", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(getBankAccount).mockResolvedValueOnce({ id: "ba1", companyId: COMPANY_ID } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(true);

    const res = await PATCH(patchReq({}), params("ba1"));

    expect(res.status).toBe(400);
  });

  it("updates the bank account and logs an audit event", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(getBankAccount).mockResolvedValueOnce({ id: "ba1", companyId: COMPANY_ID } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(true);
    vi.mocked(updateBankAccount).mockResolvedValueOnce({ id: "ba1", name: "New name" } as never);

    const res = await PATCH(patchReq({ name: "New name" }), params("ba1"));

    expect(res.status).toBe(200);
    expect(updateBankAccount).toHaveBeenCalledWith("ba1", { name: "New name" });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "bank_account.update", objectId: "ba1" })
    );
  });
});
