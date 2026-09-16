import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/rbac", () => ({
  canAccessCompany: vi.fn(),
  canManageTreasury: vi.fn(),
  canApproveIntercompany: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: { findUnique: vi.fn() },
    bankAccount: { findUnique: vi.fn() },
    intercompanyTransfer: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/treasury/intercompany", async () => {
  const actual = await vi.importActual<typeof import("@/lib/treasury/intercompany")>(
    "@/lib/treasury/intercompany"
  );
  return {
    createIntercompanyTransfer: vi.fn(),
    approveIntercompanyTransfer: vi.fn(),
    rejectIntercompanyTransfer: vi.fn(),
    reconcileIntercompanyTransfer: vi.fn(),
    listIntercompanyTransfers: vi.fn(),
    IntercompanyValidationError: actual.IntercompanyValidationError,
  };
});

import { getCurrentUser } from "@/lib/session";
import { canAccessCompany, canApproveIntercompany, canManageTreasury } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import {
  createIntercompanyTransfer,
  approveIntercompanyTransfer,
  rejectIntercompanyTransfer,
  reconcileIntercompanyTransfer,
  listIntercompanyTransfers,
  IntercompanyValidationError,
} from "@/lib/treasury/intercompany";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/intercompany-transfers/route";
import { POST as approveRoute } from "@/app/api/v1/intercompany-transfers/[id]/approve/route";
import { POST as rejectRoute } from "@/app/api/v1/intercompany-transfers/[id]/reject/route";
import { POST as reconcileRoute } from "@/app/api/v1/intercompany-transfers/[id]/reconcile/route";

const BANK_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const bankAccount = { id: BANK_ACCOUNT_ID, companyId: "c1" };
const fromCompany = { id: "c1", organizationId: "org1" };
const toCompany = { id: "c2", organizationId: "org1" };
const DEST_ID = "22222222-2222-4222-8222-222222222222";
const TO_COMPANY_ID = "33333333-3333-4333-8333-333333333333";

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

describe("POST /api/v1/intercompany-transfers", () => {
  const url = "http://localhost/api/v1/intercompany-transfers";
  const validBody = { bankAccountId: BANK_ACCOUNT_ID, toCompanyId: TO_COMPANY_ID, destinationAccountId: DEST_ID, amount: "10.00" };

  it("requires an Idempotency-Key header", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.bankAccount.findUnique).mockResolvedValueOnce(bankAccount as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(fromCompany as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(true);

    const res = await createRoute(postReq(url, validBody));

    expect(res.status).toBe(400);
    expect(createIntercompanyTransfer).not.toHaveBeenCalled();
  });

  it("rejects a caller who can't manage treasury on the source company", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.bankAccount.findUnique).mockResolvedValueOnce(bankAccount as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(fromCompany as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(false);

    const res = await createRoute(postReq(url, validBody, { "Idempotency-Key": "k1" }));

    expect(res.status).toBe(403);
  });

  it("translates an IntercompanyValidationError into a 400", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.bankAccount.findUnique).mockResolvedValueOnce(bankAccount as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(fromCompany as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(true);
    vi.mocked(createIntercompanyTransfer).mockRejectedValueOnce(
      new IntercompanyValidationError("currency mismatch")
    );

    const res = await createRoute(postReq(url, validBody, { "Idempotency-Key": "k1" }));

    expect(res.status).toBe(400);
  });

  it("creates the transfer", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.bankAccount.findUnique).mockResolvedValueOnce(bankAccount as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(fromCompany as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(true);
    vi.mocked(createIntercompanyTransfer).mockResolvedValueOnce({ id: "ic1" } as never);

    const res = await createRoute(postReq(url, validBody, { "Idempotency-Key": "k1" }));

    expect(res.status).toBe(201);
    expect(createIntercompanyTransfer).toHaveBeenCalledWith(
      bankAccount,
      expect.objectContaining({ toCompanyId: TO_COMPANY_ID, destinationAccountId: DEST_ID, idempotencyKey: "k1" })
    );
  });
});

describe("GET /api/v1/intercompany-transfers", () => {
  it("returns 404 (not 403) without company access", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(fromCompany as never);
    vi.mocked(canAccessCompany).mockResolvedValueOnce(false);

    const res = await listRoute(new Request("http://localhost/api/v1/intercompany-transfers?companyId=c1"));

    expect(res.status).toBe(404);
  });

  it("lists transfers for a member", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(fromCompany as never);
    vi.mocked(canAccessCompany).mockResolvedValueOnce(true);
    vi.mocked(listIntercompanyTransfers).mockResolvedValueOnce([{ id: "ic1" }] as never);

    const res = await listRoute(new Request("http://localhost/api/v1/intercompany-transfers?companyId=c1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "ic1" }]);
  });
});

describe("POST /api/v1/intercompany-transfers/:id/approve", () => {
  it("rejects a caller without org-level approver rights", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.intercompanyTransfer.findUnique).mockResolvedValueOnce({
      id: "ic1",
      organizationId: "org1",
    } as never);
    vi.mocked(canApproveIntercompany).mockResolvedValueOnce(false);

    const res = await approveRoute(
      new Request("http://localhost/api/v1/intercompany-transfers/ic1/approve", { method: "POST" }),
      params("ic1")
    );

    expect(res.status).toBe(403);
    expect(approveIntercompanyTransfer).not.toHaveBeenCalled();
  });

  it("approves the transfer", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.intercompanyTransfer.findUnique).mockResolvedValueOnce({
      id: "ic1",
      organizationId: "org1",
    } as never);
    vi.mocked(canApproveIntercompany).mockResolvedValueOnce(true);
    vi.mocked(approveIntercompanyTransfer).mockResolvedValueOnce({ id: "ic1", status: "APPROVED" } as never);

    const res = await approveRoute(
      new Request("http://localhost/api/v1/intercompany-transfers/ic1/approve", { method: "POST" }),
      params("ic1")
    );

    expect(res.status).toBe(200);
    expect(approveIntercompanyTransfer).toHaveBeenCalledWith("ic1", expect.objectContaining({ actorUserId: "u1" }));
  });
});

describe("POST /api/v1/intercompany-transfers/:id/reject", () => {
  it("rejects a caller without org-level approver rights", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.intercompanyTransfer.findUnique).mockResolvedValueOnce({
      id: "ic1",
      organizationId: "org1",
    } as never);
    vi.mocked(canApproveIntercompany).mockResolvedValueOnce(false);

    const res = await rejectRoute(
      new Request("http://localhost/api/v1/intercompany-transfers/ic1/reject", { method: "POST" }),
      params("ic1")
    );

    expect(res.status).toBe(403);
    expect(rejectIntercompanyTransfer).not.toHaveBeenCalled();
  });

  it("rejects the transfer with a reason", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.intercompanyTransfer.findUnique).mockResolvedValueOnce({
      id: "ic1",
      organizationId: "org1",
    } as never);
    vi.mocked(canApproveIntercompany).mockResolvedValueOnce(true);
    vi.mocked(rejectIntercompanyTransfer).mockResolvedValueOnce({ id: "ic1", status: "REJECTED" } as never);

    const res = await rejectRoute(
      postReq("http://localhost/api/v1/intercompany-transfers/ic1/reject", { reason: "wrong amount" }),
      params("ic1")
    );

    expect(res.status).toBe(200);
    expect(rejectIntercompanyTransfer).toHaveBeenCalledWith(
      "ic1",
      expect.objectContaining({ actorUserId: "u1" }),
      "wrong amount"
    );
  });
});

describe("POST /api/v1/intercompany-transfers/:id/reconcile", () => {
  it("rejects a caller who can't manage treasury for the receiving company", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.intercompanyTransfer.findUnique).mockResolvedValueOnce({
      id: "ic1",
      toCompanyId: "c2",
    } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(toCompany as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(false);

    const res = await reconcileRoute(
      new Request("http://localhost/api/v1/intercompany-transfers/ic1/reconcile", { method: "POST" }),
      params("ic1")
    );

    expect(res.status).toBe(403);
    expect(reconcileIntercompanyTransfer).not.toHaveBeenCalled();
  });

  it("reconciles the transfer", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.intercompanyTransfer.findUnique).mockResolvedValueOnce({
      id: "ic1",
      toCompanyId: "c2",
    } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(toCompany as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(true);
    vi.mocked(reconcileIntercompanyTransfer).mockResolvedValueOnce({
      id: "ic1",
      reconciledAt: new Date(),
    } as never);

    const res = await reconcileRoute(
      new Request("http://localhost/api/v1/intercompany-transfers/ic1/reconcile", { method: "POST" }),
      params("ic1")
    );

    expect(res.status).toBe(200);
    expect(reconcileIntercompanyTransfer).toHaveBeenCalledWith("ic1", expect.objectContaining({ actorUserId: "u1" }));
  });
});
