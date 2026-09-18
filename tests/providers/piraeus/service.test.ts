import { describe, expect, it, vi, beforeEach } from "vitest";

process.env.PIRAEUS_FINGERPRINT_KEY = "test-fingerprint-key";
process.env.PIRAEUS_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

vi.mock("@/lib/prisma", () => ({
  prisma: {
    providerConnection: { upsert: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
    providerAccountLink: { findFirst: vi.fn(), create: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    syncState: { create: vi.fn(), update: vi.fn() },
    company: { findUniqueOrThrow: vi.fn() },
    bankAccount: { findUniqueOrThrow: vi.fn() },
    balanceObservation: { create: vi.fn(), findFirst: vi.fn() },
    externalTransaction: { createMany: vi.fn() },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  },
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/treasury/balances", () => ({ getBankAccountBalance: vi.fn() }));
vi.mock("@/lib/providers/registry", () => ({ getOrCreateProvider: vi.fn() }));
vi.mock("@/lib/providers/piraeus/oauth", () => ({
  createAuthorizationRequest: vi.fn(),
  exchangeAuthorizationCode: vi.fn(),
  validateAndConsumeState: vi.fn(),
  findStateOrganizationId: vi.fn(),
}));
vi.mock("@/lib/providers/piraeus/connection", () => ({ getValidAccessToken: vi.fn() }));
vi.mock("@/lib/providers/piraeus/provider", () => ({
  piraeusBankAccountInformationProvider: { listAccounts: vi.fn(), getBalances: vi.fn() },
}));
vi.mock("@/lib/providers/piraeus/accounts", () => ({ getRawAccountIdentifier: vi.fn(), getTransactions: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { getBankAccountBalance } from "@/lib/treasury/balances";
import { getOrCreateProvider } from "@/lib/providers/registry";
import { createAuthorizationRequest, exchangeAuthorizationCode, validateAndConsumeState } from "@/lib/providers/piraeus/oauth";
import { getValidAccessToken } from "@/lib/providers/piraeus/connection";
import { piraeusBankAccountInformationProvider as provider } from "@/lib/providers/piraeus/provider";
import { getRawAccountIdentifier, getTransactions } from "@/lib/providers/piraeus/accounts";
import { PiraeusOAuthStateError } from "@/lib/providers/piraeus/errors";
import {
  PiraeusServiceError,
  SyncCooldownError,
  compareLatestBalanceToLedger,
  completeConnection,
  initiateConnection,
  linkBankAccount,
  observeBalance,
  syncTransactions,
  unlinkBankAccount,
} from "@/lib/providers/piraeus/service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("initiateConnection", () => {
  it("provisions the org's Provider row and returns an authorization URL", async () => {
    vi.mocked(getOrCreateProvider).mockResolvedValueOnce({ id: "prov1" } as never);
    vi.mocked(prisma.providerConnection.upsert).mockResolvedValueOnce({} as never);
    vi.mocked(createAuthorizationRequest).mockResolvedValueOnce({ url: "https://authorize", state: "s1" });

    const result = await initiateConnection({ organizationId: "org1", userId: "u1" });

    expect(result.authorizationUrl).toBe("https://authorize");
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "piraeus.connection_initiated" }));
  });
});

describe("completeConnection", () => {
  it("logs a best-effort failure audit and rethrows on an invalid/reused state", async () => {
    vi.mocked(validateAndConsumeState).mockRejectedValueOnce(new PiraeusOAuthStateError("bad state"));
    const { findStateOrganizationId } = await import("@/lib/providers/piraeus/oauth");
    vi.mocked(findStateOrganizationId).mockResolvedValueOnce("org1");

    await expect(completeConnection("bad-state", "code1")).rejects.toBeInstanceOf(PiraeusOAuthStateError);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "piraeus.connection_failed", organizationId: "org1" }));
  });

  it("skips the audit call entirely when the state row is gone (no org to attribute it to)", async () => {
    vi.mocked(validateAndConsumeState).mockRejectedValueOnce(new PiraeusOAuthStateError("bad state"));
    const { findStateOrganizationId } = await import("@/lib/providers/piraeus/oauth");
    vi.mocked(findStateOrganizationId).mockResolvedValueOnce(undefined);

    await expect(completeConnection("bad-state", "code1")).rejects.toBeInstanceOf(PiraeusOAuthStateError);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("exchanges the code, stores the connection, and audits connection_established", async () => {
    vi.mocked(validateAndConsumeState).mockResolvedValueOnce({ organizationId: "org1", userId: "u1" } as never);
    vi.mocked(getOrCreateProvider).mockResolvedValueOnce({ id: "prov1" } as never);
    vi.mocked(exchangeAuthorizationCode).mockResolvedValueOnce({
      access_token: "at",
      refresh_token: "rt",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "winbankAccess.info",
    });
    vi.mocked(prisma.providerConnection.upsert).mockResolvedValueOnce({ id: "conn1", status: "CONNECTED" } as never);

    const result = await completeConnection("s1", "code1");

    expect((result as { status: string }).status).toBe("CONNECTED");
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "piraeus.connection_established" }));
  });

  it("marks the connection FAILED and audits connection_failed if the code exchange throws", async () => {
    vi.mocked(validateAndConsumeState).mockResolvedValueOnce({ organizationId: "org1", userId: "u1" } as never);
    vi.mocked(getOrCreateProvider).mockResolvedValueOnce({ id: "prov1" } as never);
    vi.mocked(exchangeAuthorizationCode).mockRejectedValueOnce(new Error("token endpoint 500"));

    await expect(completeConnection("s1", "code1")).rejects.toThrow("token endpoint 500");
    expect(prisma.providerConnection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) })
    );
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "piraeus.connection_failed" }));
  });
});

describe("linkBankAccount", () => {
  const bankAccount = { id: "ba1", companyId: "c1" } as never;

  it("rejects a bank account whose company is in a different organization than the connection", async () => {
    vi.mocked(prisma.providerConnection.findUniqueOrThrow).mockResolvedValueOnce({ id: "conn1", organizationId: "org1" } as never);
    vi.mocked(prisma.company.findUniqueOrThrow).mockResolvedValueOnce({ organizationId: "org2" } as never);

    await expect(
      linkBankAccount({ bankAccount, connectionId: "conn1", externalAccountId: "ext1", actorUserId: "u1" })
    ).rejects.toBeInstanceOf(PiraeusServiceError);
  });

  it("rejects when the bank account already has an ACTIVE link", async () => {
    vi.mocked(prisma.providerConnection.findUniqueOrThrow).mockResolvedValueOnce({ id: "conn1", organizationId: "org1" } as never);
    vi.mocked(prisma.company.findUniqueOrThrow).mockResolvedValueOnce({ organizationId: "org1" } as never);
    vi.mocked(prisma.providerAccountLink.findFirst).mockResolvedValueOnce({ id: "existing" } as never);

    await expect(
      linkBankAccount({ bankAccount, connectionId: "conn1", externalAccountId: "ext1", actorUserId: "u1" })
    ).rejects.toBeInstanceOf(PiraeusServiceError);
  });

  it("re-fetches the raw identifier server-side (never trusts the client) and masks it in the audit event", async () => {
    vi.mocked(prisma.providerConnection.findUniqueOrThrow).mockResolvedValueOnce({ id: "conn1", organizationId: "org1" } as never);
    vi.mocked(prisma.company.findUniqueOrThrow).mockResolvedValueOnce({ organizationId: "org1" } as never);
    vi.mocked(prisma.providerAccountLink.findFirst).mockResolvedValueOnce(null);
    vi.mocked(getValidAccessToken).mockResolvedValueOnce("token1");
    // Obviously synthetic -- never a real production IBAN (CLAUDE.md
    // rule 19 / docs/12-REAL-ENTITIES.md).
    const syntheticIban = "GR0000000000000000000000001";
    vi.mocked(getRawAccountIdentifier).mockResolvedValueOnce(syntheticIban);
    vi.mocked(prisma.providerAccountLink.create).mockResolvedValueOnce({ id: "link1" } as never);
    vi.mocked(prisma.syncState.create).mockResolvedValueOnce({} as never);

    await linkBankAccount({ bankAccount, connectionId: "conn1", externalAccountId: "ext1", actorUserId: "u1" });

    const auditCall = vi.mocked(logAudit).mock.calls[0]![0];
    expect(JSON.stringify(auditCall)).not.toContain(syntheticIban);
    expect((auditCall.metadata as { maskedExternalAccount: string }).maskedExternalAccount).toBe("****0001");
  });
});

describe("unlinkBankAccount", () => {
  it("is idempotent once already UNLINKED", async () => {
    vi.mocked(prisma.providerAccountLink.findUniqueOrThrow).mockResolvedValueOnce({
      id: "link1",
      status: "UNLINKED",
      providerConnection: { organizationId: "org1" },
    } as never);

    const result = await unlinkBankAccount("link1", "u1");

    expect(result.status).toBe("UNLINKED");
    expect(prisma.providerAccountLink.update).not.toHaveBeenCalled();
  });
});

describe("observeBalance / compareLatestBalanceToLedger", () => {
  it("persists balance observations and never writes to the ledger", async () => {
    vi.mocked(prisma.providerConnection.findUniqueOrThrow).mockResolvedValueOnce({ organizationId: "org1" } as never);
    vi.mocked(prisma.bankAccount.findUniqueOrThrow).mockResolvedValueOnce({ id: "ba1", companyId: "c1" } as never);
    vi.mocked(getValidAccessToken).mockResolvedValueOnce("token1");
    vi.mocked(provider.getBalances).mockResolvedValueOnce([
      { balanceType: "closingBooked", amount: "500.00", currency: "EUR", observedAt: "2026-09-19T00:00:00Z" },
    ]);
    vi.mocked(prisma.balanceObservation.create).mockResolvedValueOnce({ id: "obs1" } as never);

    const rows = await observeBalance({ id: "link1", bankAccountId: "ba1", providerConnectionId: "conn1", externalAccountId: "ext1" });

    expect(rows).toHaveLength(1);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "piraeus.balance_observed" }));
  });

  it("compareLatestBalanceToLedger returns null when nothing has been observed yet", async () => {
    vi.mocked(prisma.balanceObservation.findFirst).mockResolvedValueOnce(null);
    const result = await compareLatestBalanceToLedger({ id: "ba1" } as never);
    expect(result).toBeNull();
    expect(getBankAccountBalance).not.toHaveBeenCalled();
  });

  it("compareLatestBalanceToLedger produces a comparison without mutating anything", async () => {
    vi.mocked(prisma.balanceObservation.findFirst).mockResolvedValueOnce({
      observedAt: new Date("2026-09-19"),
      balanceType: "closingBooked",
      amount: { toString: () => "500.00" },
      currency: "EUR",
    } as never);
    vi.mocked(getBankAccountBalance).mockResolvedValueOnce({ balance: "500.00" } as never);

    const result = await compareLatestBalanceToLedger({ id: "ba1" } as never);

    expect(result!.matches).toBe(true);
    expect(result!.providerAmount).toBe("500.00");
    expect(result!.ledgerAmount).toBe("500.00");
  });
});

describe("syncTransactions", () => {
  const link = {
    id: "link1",
    status: "ACTIVE",
    bankAccountId: "ba1",
    externalAccountId: "ext1",
    providerConnectionId: "conn1",
    syncState: { id: "sync1", nextAllowedSyncAt: null, lastSyncedBookingDate: null, consecutiveFailures: 0 },
    providerConnection: { organizationId: "org1" },
    bankAccount: { companyId: "c1" },
  };

  it("rejects syncing a link that isn't ACTIVE", async () => {
    vi.mocked(prisma.providerAccountLink.findUniqueOrThrow).mockResolvedValueOnce({ ...link, status: "UNLINKED" } as never);
    await expect(syncTransactions("link1", { manual: false })).rejects.toBeInstanceOf(PiraeusServiceError);
  });

  it("enforces the manual-sync cooldown", async () => {
    vi.mocked(prisma.providerAccountLink.findUniqueOrThrow).mockResolvedValueOnce({
      ...link,
      syncState: { ...link.syncState, nextAllowedSyncAt: new Date(Date.now() + 60_000) },
    } as never);
    await expect(syncTransactions("link1", { manual: true })).rejects.toBeInstanceOf(SyncCooldownError);
  });

  it("does not enforce the cooldown for a non-manual (worker) sync", async () => {
    vi.mocked(prisma.providerAccountLink.findUniqueOrThrow).mockResolvedValueOnce({
      ...link,
      syncState: { ...link.syncState, nextAllowedSyncAt: new Date(Date.now() + 60_000) },
    } as never);
    vi.mocked(prisma.syncState.update).mockResolvedValue({} as never);
    vi.mocked(getValidAccessToken).mockResolvedValueOnce("token1");
    vi.mocked(getTransactions).mockResolvedValueOnce([]);

    const result = await syncTransactions("link1", { manual: false });
    expect(result).toEqual({ fetched: 0, created: 0 });
  });

  it("dedupes via skipDuplicates -- a repeated sync reports 0 newly created rows", async () => {
    vi.mocked(prisma.providerAccountLink.findUniqueOrThrow).mockResolvedValueOnce(link as never);
    vi.mocked(prisma.syncState.update).mockResolvedValue({} as never);
    vi.mocked(getValidAccessToken).mockResolvedValueOnce("token1");
    vi.mocked(getTransactions).mockResolvedValueOnce([
      { fingerprint: "fp1", bookingDate: "2026-09-19", amount: "10.00", currency: "EUR", creditDebitIndicator: "CREDIT" },
    ]);
    vi.mocked(prisma.externalTransaction.createMany).mockResolvedValueOnce({ count: 0 }); // already existed

    const result = await syncTransactions("link1", { manual: true });

    expect(result).toEqual({ fetched: 1, created: 0 });
    expect(prisma.externalTransaction.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });

  it("marks the sync state ERROR and rethrows on a provider failure", async () => {
    vi.mocked(prisma.providerAccountLink.findUniqueOrThrow).mockResolvedValueOnce(link as never);
    vi.mocked(prisma.syncState.update).mockResolvedValue({} as never);
    vi.mocked(getValidAccessToken).mockRejectedValueOnce(new Error("token refresh failed"));

    await expect(syncTransactions("link1", { manual: true })).rejects.toThrow("token refresh failed");
    expect(prisma.syncState.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ERROR" }) })
    );
  });
});
