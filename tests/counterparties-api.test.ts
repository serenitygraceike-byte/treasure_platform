import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/rbac", () => ({ isOrgManager: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    membership: { findUnique: vi.fn() },
    counterparty: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/counterparties", () => ({
  createCounterparty: vi.fn(),
  listCounterparties: vi.fn(),
  createBeneficiary: vi.fn(),
  listBeneficiaries: vi.fn(),
}));

import { getCurrentUser } from "@/lib/session";
import { isOrgManager } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { createBeneficiary, createCounterparty, listBeneficiaries, listCounterparties } from "@/lib/counterparties";
import { GET as listCounterpartiesRoute, POST as createCounterpartyRoute } from "@/app/api/v1/counterparties/route";
import {
  GET as listBeneficiariesRoute,
  POST as createBeneficiaryRoute,
} from "@/app/api/v1/counterparties/[id]/beneficiaries/route";

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function postReq(url: string, body: unknown) {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/v1/counterparties", () => {
  it("rejects a non-org-manager", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(isOrgManager).mockResolvedValueOnce(false);

    const res = await createCounterpartyRoute(
      postReq("http://localhost/api/v1/counterparties", { organizationId: "org1", legalName: "Acme", type: "COMPANY" })
    );

    expect(res.status).toBe(403);
    expect(createCounterparty).not.toHaveBeenCalled();
  });

  it("creates the counterparty", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(isOrgManager).mockResolvedValueOnce(true);
    vi.mocked(createCounterparty).mockResolvedValueOnce({ id: "cp1" } as never);

    const res = await createCounterpartyRoute(
      postReq("http://localhost/api/v1/counterparties", { organizationId: "org1", legalName: "Acme", type: "COMPANY" })
    );

    expect(res.status).toBe(201);
  });
});

describe("GET /api/v1/counterparties", () => {
  it("lists counterparties for a member", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce({ role: "VIEWER" } as never);
    vi.mocked(listCounterparties).mockResolvedValueOnce([{ id: "cp1" }] as never);

    const res = await listCounterpartiesRoute(new Request("http://localhost/api/v1/counterparties?organizationId=org1"));

    expect(res.status).toBe(200);
  });
});

describe("POST /api/v1/counterparties/:id/beneficiaries", () => {
  it("rejects a non-org-manager", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.counterparty.findUnique).mockResolvedValueOnce({ id: "cp1", organizationId: "org1" } as never);
    vi.mocked(isOrgManager).mockResolvedValueOnce(false);

    const res = await createBeneficiaryRoute(
      postReq("http://localhost/x", { paymentMethod: "BANK_TRANSFER", payoutDetails: "IBAN123" }),
      params("cp1")
    );

    expect(res.status).toBe(403);
    expect(createBeneficiary).not.toHaveBeenCalled();
  });

  it("creates the beneficiary", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.counterparty.findUnique).mockResolvedValueOnce({ id: "cp1", organizationId: "org1" } as never);
    vi.mocked(isOrgManager).mockResolvedValueOnce(true);
    vi.mocked(createBeneficiary).mockResolvedValueOnce({ id: "b1" } as never);

    const res = await createBeneficiaryRoute(
      postReq("http://localhost/x", { paymentMethod: "BANK_TRANSFER", payoutDetails: "IBAN123" }),
      params("cp1")
    );

    expect(res.status).toBe(201);
  });
});

describe("GET /api/v1/counterparties/:id/beneficiaries", () => {
  it("returns 404 for a counterparty outside the caller's organization", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.counterparty.findUnique).mockResolvedValueOnce({ id: "cp1", organizationId: "org1" } as never);
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce(null);

    const res = await listBeneficiariesRoute(new Request("http://localhost/x"), params("cp1"));

    expect(res.status).toBe(404);
    expect(listBeneficiaries).not.toHaveBeenCalled();
  });
});
