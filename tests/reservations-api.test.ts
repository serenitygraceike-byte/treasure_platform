import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/rbac", () => ({ canAccessCompany: vi.fn(), canManageTreasury: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: { findUnique: vi.fn() },
    bankAccount: { findUnique: vi.fn() },
    bankReservation: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/treasury/reservations", () => ({
  createReservation: vi.fn(),
  releaseReservation: vi.fn(),
  listReservations: vi.fn(),
}));

import { getCurrentUser } from "@/lib/session";
import { canAccessCompany, canManageTreasury } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { createReservation, releaseReservation, listReservations } from "@/lib/treasury/reservations";
import { POST as createReservationRoute } from "@/app/api/v1/bank-accounts/[id]/reservations/route";
import { POST as releaseReservationRoute } from "@/app/api/v1/reservations/[id]/release/route";
import { GET as listReservationsRoute } from "@/app/api/v1/companies/[id]/reservations/route";

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/v1/bank-accounts/:id/reservations", () => {
  const url = "http://localhost/api/v1/bank-accounts/ba1/reservations";

  it("rejects an unauthenticated caller", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
    const res = await createReservationRoute(postReq(url, { amount: "10.00" }), params("ba1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the bank account doesn't exist", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.bankAccount.findUnique).mockResolvedValueOnce(null);
    const res = await createReservationRoute(postReq(url, { amount: "10.00" }), params("ba1"));
    expect(res.status).toBe(404);
  });

  it("rejects a caller who can't manage treasury", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.bankAccount.findUnique).mockResolvedValueOnce(bankAccount as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(false);

    const res = await createReservationRoute(
      postReq(url, { amount: "10.00" }, { "Idempotency-Key": "k1" }),
      params("ba1")
    );

    expect(res.status).toBe(403);
    expect(createReservation).not.toHaveBeenCalled();
  });

  it("requires an Idempotency-Key header", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.bankAccount.findUnique).mockResolvedValueOnce(bankAccount as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(true);

    const res = await createReservationRoute(postReq(url, { amount: "10.00" }), params("ba1"));

    expect(res.status).toBe(400);
    expect(createReservation).not.toHaveBeenCalled();
  });

  it("rejects a non-positive amount", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.bankAccount.findUnique).mockResolvedValueOnce(bankAccount as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(true);

    const res = await createReservationRoute(
      postReq(url, { amount: "0.00" }, { "Idempotency-Key": "k1" }),
      params("ba1")
    );

    expect(res.status).toBe(400);
    expect(createReservation).not.toHaveBeenCalled();
  });

  it("creates the reservation", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.bankAccount.findUnique).mockResolvedValueOnce(bankAccount as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(true);
    vi.mocked(createReservation).mockResolvedValueOnce({ id: "r1" } as never);

    const res = await createReservationRoute(
      postReq(url, { amount: "10.00" }, { "Idempotency-Key": "k1" }),
      params("ba1")
    );

    expect(res.status).toBe(201);
    expect(createReservation).toHaveBeenCalledWith(
      bankAccount,
      expect.objectContaining({ amount: "10.00", idempotencyKey: "k1", actorUserId: "u1" })
    );
  });
});

describe("POST /api/v1/reservations/:id/release", () => {
  it("rejects a caller who can't manage treasury", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.bankReservation.findUnique).mockResolvedValueOnce({ id: "r1", companyId: "c1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(false);

    const res = await releaseReservationRoute(
      new Request("http://localhost/api/v1/reservations/r1/release", { method: "POST" }),
      params("r1")
    );

    expect(res.status).toBe(403);
    expect(releaseReservation).not.toHaveBeenCalled();
  });

  it("releases the reservation", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.bankReservation.findUnique).mockResolvedValueOnce({ id: "r1", companyId: "c1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(true);
    vi.mocked(releaseReservation).mockResolvedValueOnce({ id: "r1", status: "RELEASED" } as never);

    const res = await releaseReservationRoute(
      new Request("http://localhost/api/v1/reservations/r1/release", { method: "POST" }),
      params("r1")
    );

    expect(res.status).toBe(200);
    expect(releaseReservation).toHaveBeenCalledWith("r1", expect.objectContaining({ actorUserId: "u1" }));
  });
});

describe("GET /api/v1/companies/:id/reservations", () => {
  it("returns 404 (not 403) without company access", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canAccessCompany).mockResolvedValueOnce(false);

    const res = await listReservationsRoute(
      new Request("http://localhost/api/v1/companies/c1/reservations"),
      params("c1")
    );

    expect(res.status).toBe(404);
  });

  it("lists reservations for a member", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canAccessCompany).mockResolvedValueOnce(true);
    vi.mocked(listReservations).mockResolvedValueOnce([{ id: "r1" }] as never);

    const res = await listReservationsRoute(
      new Request("http://localhost/api/v1/companies/c1/reservations"),
      params("c1")
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "r1" }]);
  });
});
