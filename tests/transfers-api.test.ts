import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/rbac", () => ({ canAccessCompany: vi.fn(), canManageTreasury: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: { findUnique: vi.fn() },
    bankAccount: { findUnique: vi.fn() },
    bankTransfer: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/treasury/transfers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/treasury/transfers")>("@/lib/treasury/transfers");
  return {
    createTransfer: vi.fn(),
    settleTransfer: vi.fn(),
    listTransfers: vi.fn(),
    TransferValidationError: actual.TransferValidationError,
  };
});

import { getCurrentUser } from "@/lib/session";
import { canAccessCompany, canManageTreasury } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import {
  createTransfer,
  settleTransfer,
  listTransfers,
  TransferValidationError,
} from "@/lib/treasury/transfers";
import { POST as createTransferRoute } from "@/app/api/v1/bank-accounts/[id]/transfers/route";
import { POST as settleTransferRoute } from "@/app/api/v1/transfers/[id]/settle/route";
import { GET as listTransfersRoute } from "@/app/api/v1/companies/[id]/transfers/route";

const bankAccount = { id: "ba1", companyId: "c1" };
const company = { id: "c1", organizationId: "org1" };

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

const DEST_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/v1/bank-accounts/:id/transfers", () => {
  const url = "http://localhost/api/v1/bank-accounts/ba1/transfers";

  it("requires an Idempotency-Key header", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.bankAccount.findUnique).mockResolvedValueOnce(bankAccount as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(true);

    const res = await createTransferRoute(
      postReq(url, { destinationAccountId: DEST_ID, amount: "10.00" }),
      params("ba1")
    );

    expect(res.status).toBe(400);
    expect(createTransfer).not.toHaveBeenCalled();
  });

  it("translates a TransferValidationError into a 400", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.bankAccount.findUnique).mockResolvedValueOnce(bankAccount as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(true);
    vi.mocked(createTransfer).mockRejectedValueOnce(new TransferValidationError("bad destination"));

    const res = await createTransferRoute(
      postReq(url, { destinationAccountId: DEST_ID, amount: "10.00" }, { "Idempotency-Key": "k1" }),
      params("ba1")
    );

    expect(res.status).toBe(400);
  });

  it("creates the transfer", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.bankAccount.findUnique).mockResolvedValueOnce(bankAccount as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(true);
    vi.mocked(createTransfer).mockResolvedValueOnce({ id: "t1" } as never);

    const res = await createTransferRoute(
      postReq(url, { destinationAccountId: DEST_ID, amount: "10.00" }, { "Idempotency-Key": "k1" }),
      params("ba1")
    );

    expect(res.status).toBe(201);
    expect(createTransfer).toHaveBeenCalledWith(
      bankAccount,
      expect.objectContaining({ destinationAccountId: DEST_ID, amount: "10.00", idempotencyKey: "k1" })
    );
  });
});

describe("POST /api/v1/transfers/:id/settle", () => {
  it("rejects a caller who can't manage treasury", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.bankTransfer.findUnique).mockResolvedValueOnce({ id: "t1", companyId: "c1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(false);

    const res = await settleTransferRoute(
      new Request("http://localhost/api/v1/transfers/t1/settle", { method: "POST" }),
      params("t1")
    );

    expect(res.status).toBe(403);
    expect(settleTransfer).not.toHaveBeenCalled();
  });

  it("settles the transfer", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.bankTransfer.findUnique).mockResolvedValueOnce({ id: "t1", companyId: "c1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(true);
    vi.mocked(settleTransfer).mockResolvedValueOnce({ id: "t1", status: "SETTLED" } as never);

    const res = await settleTransferRoute(
      new Request("http://localhost/api/v1/transfers/t1/settle", { method: "POST" }),
      params("t1")
    );

    expect(res.status).toBe(200);
    expect(settleTransfer).toHaveBeenCalledWith("t1", expect.objectContaining({ actorUserId: "u1" }));
  });
});

describe("GET /api/v1/companies/:id/transfers", () => {
  it("returns 404 (not 403) without company access", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canAccessCompany).mockResolvedValueOnce(false);

    const res = await listTransfersRoute(
      new Request("http://localhost/api/v1/companies/c1/transfers"),
      params("c1")
    );

    expect(res.status).toBe(404);
  });

  it("lists transfers for a member", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canAccessCompany).mockResolvedValueOnce(true);
    vi.mocked(listTransfers).mockResolvedValueOnce([{ id: "t1" }] as never);

    const res = await listTransfersRoute(
      new Request("http://localhost/api/v1/companies/c1/transfers"),
      params("c1")
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "t1" }]);
  });
});
