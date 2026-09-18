import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/rbac", () => ({
  canAccessCompany: vi.fn(),
  canRequestPayment: vi.fn(),
  canApprovePayment: vi.fn(),
  canManageTreasury: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: { findUnique: vi.fn() },
    bankAccount: { findUnique: vi.fn() },
    beneficiary: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/payments/payments", async () => {
  const actual = await vi.importActual<typeof import("@/lib/payments/payments")>("@/lib/payments/payments");
  return {
    createPayment: vi.fn(),
    approvePayment: vi.fn(),
    rejectPayment: vi.fn(),
    executePayment: vi.fn(),
    cancelPayment: vi.fn(),
    getPayment: vi.fn(),
    listPayments: vi.fn(),
    PaymentValidationError: actual.PaymentValidationError,
  };
});

import { getCurrentUser } from "@/lib/session";
import { canAccessCompany, canApprovePayment, canManageTreasury, canRequestPayment } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import {
  approvePayment,
  cancelPayment,
  createPayment,
  executePayment,
  getPayment,
  listPayments,
  PaymentValidationError,
  rejectPayment,
} from "@/lib/payments/payments";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/payments/route";
import { GET as getRoute } from "@/app/api/v1/payments/[id]/route";
import { POST as approveRoute } from "@/app/api/v1/payments/[id]/approve/route";
import { POST as rejectRoute } from "@/app/api/v1/payments/[id]/reject/route";
import { POST as executeRoute } from "@/app/api/v1/payments/[id]/execute/route";
import { POST as cancelRoute } from "@/app/api/v1/payments/[id]/cancel/route";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const BANK_ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const BENEFICIARY_ID = "33333333-3333-4333-8333-333333333333";
const company = { id: COMPANY_ID, organizationId: "org1" };

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function postReq(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/v1/payments", () => {
  const validBody = {
    companyId: COMPANY_ID,
    bankAccountId: BANK_ACCOUNT_ID,
    beneficiaryId: BENEFICIARY_ID,
    paymentType: "SUPPLIER",
    paymentMethod: "BANK_TRANSFER",
    amount: "10.00",
    currency: "EUR",
  };

  it("requires an Idempotency-Key header", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canRequestPayment).mockResolvedValueOnce(true);

    const res = await createRoute(postReq("http://localhost/api/v1/payments", validBody));

    expect(res.status).toBe(400);
    expect(createPayment).not.toHaveBeenCalled();
  });

  it("rejects a caller who can't request a payment", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canRequestPayment).mockResolvedValueOnce(false);

    const res = await createRoute(postReq("http://localhost/api/v1/payments", validBody, { "Idempotency-Key": "k1" }));

    expect(res.status).toBe(403);
  });

  it("creates the payment", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canRequestPayment).mockResolvedValueOnce(true);
    vi.mocked(prisma.bankAccount.findUnique).mockResolvedValueOnce({ id: BANK_ACCOUNT_ID } as never);
    vi.mocked(prisma.beneficiary.findUnique).mockResolvedValueOnce({ id: BENEFICIARY_ID } as never);
    vi.mocked(createPayment).mockResolvedValueOnce({ id: "p1" } as never);

    const res = await createRoute(postReq("http://localhost/api/v1/payments", validBody, { "Idempotency-Key": "k1" }));

    expect(res.status).toBe(201);
    expect(createPayment).toHaveBeenCalledWith(
      company,
      { id: BANK_ACCOUNT_ID },
      { id: BENEFICIARY_ID },
      expect.objectContaining({ idempotencyKey: "k1" })
    );
  });

  it("translates PaymentValidationError into a 400", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canRequestPayment).mockResolvedValueOnce(true);
    vi.mocked(prisma.bankAccount.findUnique).mockResolvedValueOnce({ id: BANK_ACCOUNT_ID } as never);
    vi.mocked(prisma.beneficiary.findUnique).mockResolvedValueOnce({ id: BENEFICIARY_ID } as never);
    vi.mocked(createPayment).mockRejectedValueOnce(new PaymentValidationError("mismatch"));

    const res = await createRoute(postReq("http://localhost/api/v1/payments", validBody, { "Idempotency-Key": "k1" }));

    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/payments", () => {
  it("returns 404 (not 403) without company access", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canAccessCompany).mockResolvedValueOnce(false);

    const res = await listRoute(new Request(`http://localhost/api/v1/payments?companyId=${COMPANY_ID}`));

    expect(res.status).toBe(404);
  });

  it("lists payments for a member", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canAccessCompany).mockResolvedValueOnce(true);
    vi.mocked(listPayments).mockResolvedValueOnce([{ id: "p1" }] as never);

    const res = await listRoute(new Request(`http://localhost/api/v1/payments?companyId=${COMPANY_ID}`));

    expect(res.status).toBe(200);
  });
});

describe("GET /api/v1/payments/:id", () => {
  it("returns 404 without company access", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(getPayment).mockResolvedValueOnce({ id: "p1", companyId: COMPANY_ID } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canAccessCompany).mockResolvedValueOnce(false);

    const res = await getRoute(new Request("http://localhost/api/v1/payments/p1"), params("p1"));

    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/payments/:id/approve", () => {
  it("rejects a caller without approver rights", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(getPayment).mockResolvedValueOnce({ id: "p1", companyId: COMPANY_ID } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canApprovePayment).mockResolvedValueOnce(false);

    const res = await approveRoute(new Request("http://localhost/x", { method: "POST" }), params("p1"));

    expect(res.status).toBe(403);
    expect(approvePayment).not.toHaveBeenCalled();
  });

  it("approves the payment", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(getPayment).mockResolvedValueOnce({ id: "p1", companyId: COMPANY_ID } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canApprovePayment).mockResolvedValueOnce(true);
    vi.mocked(approvePayment).mockResolvedValueOnce({ id: "p1", status: "APPROVED" } as never);

    const res = await approveRoute(new Request("http://localhost/x", { method: "POST" }), params("p1"));

    expect(res.status).toBe(200);
  });
});

describe("POST /api/v1/payments/:id/reject", () => {
  it("rejects the payment with a reason", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(getPayment).mockResolvedValueOnce({ id: "p1", companyId: COMPANY_ID } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canApprovePayment).mockResolvedValueOnce(true);
    vi.mocked(rejectPayment).mockResolvedValueOnce({ id: "p1", status: "REJECTED" } as never);

    const res = await rejectRoute(postReq("http://localhost/x", { reason: "bad amount" }), params("p1"));

    expect(res.status).toBe(200);
    expect(rejectPayment).toHaveBeenCalledWith("p1", expect.objectContaining({ actorUserId: "u1" }), "bad amount");
  });
});

describe("POST /api/v1/payments/:id/execute", () => {
  it("rejects a caller who can't manage treasury", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(getPayment).mockResolvedValueOnce({ id: "p1", companyId: COMPANY_ID } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(false);

    const res = await executeRoute(new Request("http://localhost/x", { method: "POST" }), params("p1"));

    expect(res.status).toBe(403);
    expect(executePayment).not.toHaveBeenCalled();
  });

  it("translates PaymentValidationError (e.g. retry limit) into a 400", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(getPayment).mockResolvedValueOnce({ id: "p1", companyId: COMPANY_ID } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(true);
    vi.mocked(executePayment).mockRejectedValueOnce(new PaymentValidationError("retry limit reached"));

    const res = await executeRoute(new Request("http://localhost/x", { method: "POST" }), params("p1"));

    expect(res.status).toBe(400);
  });

  it("executes the payment", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(getPayment).mockResolvedValueOnce({ id: "p1", companyId: COMPANY_ID } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(true);
    vi.mocked(executePayment).mockResolvedValueOnce({ id: "p1", status: "PROCESSING" } as never);

    const res = await executeRoute(new Request("http://localhost/x", { method: "POST" }), params("p1"));

    expect(res.status).toBe(200);
  });
});

describe("POST /api/v1/payments/:id/cancel", () => {
  it("cancels the payment", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(getPayment).mockResolvedValueOnce({ id: "p1", companyId: COMPANY_ID } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(true);
    vi.mocked(cancelPayment).mockResolvedValueOnce({ id: "p1", status: "CANCELLED" } as never);

    const res = await cancelRoute(new Request("http://localhost/x", { method: "POST" }), params("p1"));

    expect(res.status).toBe(200);
  });
});
