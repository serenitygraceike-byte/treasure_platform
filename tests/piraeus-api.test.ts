import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/rbac", () => ({
  canManageProviderConnections: vi.fn(),
  canManageTreasury: vi.fn(),
  canAccessCompany: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    membership: { findUnique: vi.fn() },
    bankAccount: { findUnique: vi.fn() },
    company: { findUniqueOrThrow: vi.fn() },
    providerConnection: { findUnique: vi.fn() },
    providerAccountLink: { findFirst: vi.fn() },
    externalTransaction: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/providers/piraeus/service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/providers/piraeus/service")>("@/lib/providers/piraeus/service");
  return {
    initiateConnection: vi.fn(),
    completeConnection: vi.fn(),
    listExternalAccounts: vi.fn(),
    linkBankAccount: vi.fn(),
    unlinkBankAccount: vi.fn(),
    compareLatestBalanceToLedger: vi.fn(),
    syncLinkFully: vi.fn(),
    PiraeusServiceError: actual.PiraeusServiceError,
    SyncCooldownError: actual.SyncCooldownError,
  };
});

import { getCurrentUser } from "@/lib/session";
import { canAccessCompany, canManageProviderConnections, canManageTreasury } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import {
  PiraeusServiceError,
  SyncCooldownError,
  compareLatestBalanceToLedger,
  initiateConnection,
  linkBankAccount,
  syncLinkFully,
} from "@/lib/providers/piraeus/service";
import { PiraeusOAuthStateError } from "@/lib/providers/piraeus/errors";
import { POST as connectRoute } from "@/app/api/v1/providers/piraeus/connect/route";
import { GET as callbackRoute } from "@/app/api/v1/providers/piraeus/callback/route";
import { POST as linkRoute } from "@/app/api/v1/bank-accounts/[id]/link-provider-account/route";
import { GET as externalBalanceRoute } from "@/app/api/v1/bank-accounts/[id]/external-balance/route";
import { POST as syncRoute } from "@/app/api/v1/bank-accounts/[id]/sync/route";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CONN_ID = "22222222-2222-4222-8222-222222222222";

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function postReq(url: string, body: unknown) {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/v1/providers/piraeus/connect", () => {
  it("rejects an unauthenticated caller", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
    const res = await connectRoute(postReq("http://localhost/x", { organizationId: ORG_ID }));
    expect(res.status).toBe(401);
  });

  it("rejects a caller without an org membership at all (404, not 403 -- existence isn't disclosed)", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce(null);
    const res = await connectRoute(postReq("http://localhost/x", { organizationId: ORG_ID }));
    expect(res.status).toBe(404);
    expect(initiateConnection).not.toHaveBeenCalled();
  });

  it("rejects a member without a treasury-tier role", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce({ role: "VIEWER" } as never);
    vi.mocked(canManageProviderConnections).mockResolvedValueOnce(false);
    const res = await connectRoute(postReq("http://localhost/x", { organizationId: ORG_ID }));
    expect(res.status).toBe(403);
  });

  it("initiates the connection for an authorized caller", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce({ role: "OWNER" } as never);
    vi.mocked(canManageProviderConnections).mockResolvedValueOnce(true);
    vi.mocked(initiateConnection).mockResolvedValueOnce({ authorizationUrl: "https://authorize" });

    const res = await connectRoute(postReq("http://localhost/x", { organizationId: ORG_ID }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authorizationUrl: "https://authorize" });
  });
});

describe("GET /api/v1/providers/piraeus/callback", () => {
  it("redirects with an error when Piraeus reports an error", async () => {
    const res = await callbackRoute(new Request("http://localhost/x?error=access_denied"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard?error=");
  });

  it("redirects with an expired/reused message on PiraeusOAuthStateError", async () => {
    const { completeConnection } = await import("@/lib/providers/piraeus/service");
    vi.mocked(completeConnection).mockRejectedValueOnce(new PiraeusOAuthStateError("bad state"));

    const res = await callbackRoute(new Request("http://localhost/x?state=s1&code=c1"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("already+used");
  });

  it("redirects with piraeusConnected=1 on success", async () => {
    const { completeConnection } = await import("@/lib/providers/piraeus/service");
    vi.mocked(completeConnection).mockResolvedValueOnce({} as never);

    const res = await callbackRoute(new Request("http://localhost/x?state=s1&code=c1"));

    expect(res.headers.get("location")).toContain("piraeusConnected=1");
  });
});

describe("POST /api/v1/bank-accounts/:id/link-provider-account", () => {
  it("translates PiraeusServiceError (cross-org) into a 400", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.bankAccount.findUnique).mockResolvedValueOnce({ id: "ba1", companyId: "c1" } as never);
    vi.mocked(prisma.company.findUniqueOrThrow).mockResolvedValueOnce({ id: "c1", organizationId: "org1" } as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(true);
    vi.mocked(linkBankAccount).mockRejectedValueOnce(new PiraeusServiceError("cross-org"));

    const res = await linkRoute(postReq("http://localhost/x", { connectionId: CONN_ID, externalAccountId: "ext1" }), params("ba1"));

    expect(res.status).toBe(400);
  });

  it("rejects a caller who can't manage treasury for the bank account's company", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.bankAccount.findUnique).mockResolvedValueOnce({ id: "ba1", companyId: "c1" } as never);
    vi.mocked(prisma.company.findUniqueOrThrow).mockResolvedValueOnce({ id: "c1", organizationId: "org1" } as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(false);

    const res = await linkRoute(postReq("http://localhost/x", { connectionId: CONN_ID, externalAccountId: "ext1" }), params("ba1"));

    expect(res.status).toBe(403);
    expect(linkBankAccount).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/bank-accounts/:id/external-balance", () => {
  it("returns 404 (not 403) for a caller without company access -- read-only route, no ledger mutation possible either way", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.bankAccount.findUnique).mockResolvedValueOnce({ id: "ba1", companyId: "c1" } as never);
    vi.mocked(prisma.company.findUniqueOrThrow).mockResolvedValueOnce({ id: "c1", organizationId: "org1" } as never);
    vi.mocked(canAccessCompany).mockResolvedValueOnce(false);

    const res = await externalBalanceRoute(new Request("http://localhost/x"), params("ba1"));

    expect(res.status).toBe(404);
    expect(compareLatestBalanceToLedger).not.toHaveBeenCalled();
  });

  it("returns the comparison for an authorized viewer", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.bankAccount.findUnique).mockResolvedValueOnce({ id: "ba1", companyId: "c1" } as never);
    vi.mocked(prisma.company.findUniqueOrThrow).mockResolvedValueOnce({ id: "c1", organizationId: "org1" } as never);
    vi.mocked(canAccessCompany).mockResolvedValueOnce(true);
    vi.mocked(compareLatestBalanceToLedger).mockResolvedValueOnce({ matches: true } as never);

    const res = await externalBalanceRoute(new Request("http://localhost/x"), params("ba1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ matches: true });
  });
});

describe("POST /api/v1/bank-accounts/:id/sync", () => {
  it("returns 429 on a cooldown", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.bankAccount.findUnique).mockResolvedValueOnce({ id: "ba1", companyId: "c1" } as never);
    vi.mocked(prisma.company.findUniqueOrThrow).mockResolvedValueOnce({ id: "c1", organizationId: "org1" } as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(true);
    vi.mocked(prisma.providerAccountLink.findFirst).mockResolvedValueOnce({ id: "link1" } as never);
    vi.mocked(syncLinkFully).mockRejectedValueOnce(new SyncCooldownError("cooling down"));

    const res = await syncRoute(new Request("http://localhost/x", { method: "POST" }), params("ba1"));

    expect(res.status).toBe(429);
  });

  it("returns 404 when there is no active provider link", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.bankAccount.findUnique).mockResolvedValueOnce({ id: "ba1", companyId: "c1" } as never);
    vi.mocked(prisma.company.findUniqueOrThrow).mockResolvedValueOnce({ id: "c1", organizationId: "org1" } as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(true);
    vi.mocked(prisma.providerAccountLink.findFirst).mockResolvedValueOnce(null);

    const res = await syncRoute(new Request("http://localhost/x", { method: "POST" }), params("ba1"));

    expect(res.status).toBe(404);
  });

  it("succeeds for an authorized caller with an active link", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.bankAccount.findUnique).mockResolvedValueOnce({ id: "ba1", companyId: "c1" } as never);
    vi.mocked(prisma.company.findUniqueOrThrow).mockResolvedValueOnce({ id: "c1", organizationId: "org1" } as never);
    vi.mocked(canManageTreasury).mockResolvedValueOnce(true);
    vi.mocked(prisma.providerAccountLink.findFirst).mockResolvedValueOnce({ id: "link1" } as never);
    vi.mocked(syncLinkFully).mockResolvedValueOnce({ balanceObserved: true, fetched: 2, created: 2 });

    const res = await syncRoute(new Request("http://localhost/x", { method: "POST" }), params("ba1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ balanceObserved: true, fetched: 2, created: 2 });
  });
});
