import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { getBankAccountBalance } from "@/lib/treasury/balances";
import { getOrCreateProvider } from "../registry";
import { encryptPiraeusToken, fingerprintAccountIdentifier, maskAccountIdentifier } from "@/lib/crypto/encryption";
import { createAuthorizationRequest, exchangeAuthorizationCode, findStateOrganizationId, validateAndConsumeState } from "./oauth";
import { getValidAccessToken } from "./connection";
import { piraeusBankAccountInformationProvider as provider } from "./provider";
import { getRawAccountIdentifier, getTransactions } from "./accounts";
import { PiraeusOAuthStateError } from "./errors";
import type { BankAccount } from "../../../generated/prisma/client";

export class PiraeusServiceError extends Error {}

// ---------------------------------------------------------------------
// Connect (OAuth)
// ---------------------------------------------------------------------

export async function initiateConnection(input: { organizationId: string; userId: string; companyId?: string }) {
  const providerRow = await getOrCreateProvider(input.organizationId, "PIRAEUS_BANK");
  await prisma.providerConnection.upsert({
    where: { organizationId_providerId: { organizationId: input.organizationId, providerId: providerRow.id } },
    update: {},
    create: { organizationId: input.organizationId, providerId: providerRow.id, status: "PENDING" },
  });

  const { url } = await createAuthorizationRequest({
    organizationId: input.organizationId,
    userId: input.userId,
    companyId: input.companyId,
  });

  await logAudit({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    action: "piraeus.connection_initiated",
    objectType: "provider",
    objectId: providerRow.id,
  });

  return { authorizationUrl: url };
}

export async function completeConnection(state: string, code: string) {
  let stateRow;
  try {
    stateRow = await validateAndConsumeState(state);
  } catch (err) {
    if (err instanceof PiraeusOAuthStateError) {
      // Best-effort: the state row may still exist (expired/already
      // consumed) even though validateAndConsumeState rejected it, in
      // which case we still know which org to attribute this to.
      const organizationId = await findStateOrganizationId(state);
      if (organizationId) {
        await logAudit({
          organizationId,
          action: "piraeus.connection_failed",
          objectType: "oauth_state",
          metadata: { reason: "invalid_or_reused_state" },
        });
      }
    }
    throw err;
  }

  const providerRow = await getOrCreateProvider(stateRow.organizationId, "PIRAEUS_BANK");

  try {
    const tokens = await exchangeAuthorizationCode(code);
    const connection = await prisma.providerConnection.upsert({
      where: { organizationId_providerId: { organizationId: stateRow.organizationId, providerId: providerRow.id } },
      update: {
        status: "CONNECTED",
        encryptedAccessToken: encryptPiraeusToken(tokens.access_token),
        encryptedRefreshToken: tokens.refresh_token ? encryptPiraeusToken(tokens.refresh_token) : undefined,
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        grantedScope: tokens.scope,
        connectedBy: stateRow.userId,
        connectedAt: new Date(),
        lastError: null,
        version: { increment: 1 },
      },
      create: {
        organizationId: stateRow.organizationId,
        providerId: providerRow.id,
        status: "CONNECTED",
        encryptedAccessToken: encryptPiraeusToken(tokens.access_token),
        encryptedRefreshToken: tokens.refresh_token ? encryptPiraeusToken(tokens.refresh_token) : undefined,
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        grantedScope: tokens.scope,
        connectedBy: stateRow.userId,
        connectedAt: new Date(),
      },
    });

    await logAudit({
      organizationId: stateRow.organizationId,
      actorUserId: stateRow.userId,
      action: "piraeus.connection_established",
      objectType: "provider_connection",
      objectId: connection.id,
      metadata: { scope: tokens.scope },
    });

    return connection;
  } catch (err) {
    await prisma.providerConnection.updateMany({
      where: { organizationId: stateRow.organizationId, providerId: providerRow.id },
      data: { status: "FAILED", lastError: err instanceof Error ? err.message : "Connection failed." },
    });
    await logAudit({
      organizationId: stateRow.organizationId,
      actorUserId: stateRow.userId,
      action: "piraeus.connection_failed",
      objectType: "provider",
      objectId: providerRow.id,
    });
    throw err;
  }
}

// ---------------------------------------------------------------------
// Account linking
// ---------------------------------------------------------------------

export async function listExternalAccounts(connectionId: string) {
  const accessToken = await getValidAccessToken(connectionId);
  return provider.listAccounts({ accessToken });
}

// Explicit, one-account-at-a-time linking -- never auto-link everything
// Piraeus returns (task brief: "Do NOT create duplicate ... merely
// because Piraeus returns an account", "must be explicit and limited").
export async function linkBankAccount(input: {
  bankAccount: BankAccount;
  connectionId: string;
  externalAccountId: string;
  actorUserId: string;
}) {
  const connection = await prisma.providerConnection.findUniqueOrThrow({ where: { id: input.connectionId } });
  const company = await prisma.company.findUniqueOrThrow({ where: { id: input.bankAccount.companyId } });
  if (company.organizationId !== connection.organizationId) {
    throw new PiraeusServiceError("This bank account belongs to a different organization than the connection.");
  }

  const existingActive = await prisma.providerAccountLink.findFirst({
    where: { bankAccountId: input.bankAccount.id, status: "ACTIVE" },
  });
  if (existingActive) {
    throw new PiraeusServiceError("This bank account already has an active provider link. Unlink it first.");
  }

  // Re-fetched fresh from Piraeus, never trusted from the client --
  // see lib/providers/piraeus/accounts.ts getRawAccountIdentifier.
  const accessToken = await getValidAccessToken(input.connectionId);
  const rawIdentifier = await getRawAccountIdentifier(accessToken, input.externalAccountId);

  const link = await prisma.providerAccountLink.create({
    data: {
      bankAccountId: input.bankAccount.id,
      providerConnectionId: input.connectionId,
      externalAccountId: input.externalAccountId,
      externalAccountFingerprint: fingerprintAccountIdentifier(rawIdentifier),
      linkedBy: input.actorUserId,
    },
  });
  await prisma.syncState.create({ data: { providerAccountLinkId: link.id } });

  await logAudit({
    organizationId: connection.organizationId,
    actorUserId: input.actorUserId,
    action: "piraeus.bank_account_linked",
    objectType: "provider_account_link",
    objectId: link.id,
    metadata: { bankAccountId: input.bankAccount.id, maskedExternalAccount: maskAccountIdentifier(rawIdentifier) },
  });

  return link;
}

export async function unlinkBankAccount(linkId: string, actorUserId: string) {
  const link = await prisma.providerAccountLink.findUniqueOrThrow({
    where: { id: linkId },
    include: { providerConnection: true },
  });
  if (link.status === "UNLINKED") return link;

  const updated = await prisma.providerAccountLink.update({
    where: { id: linkId },
    data: { status: "UNLINKED", unlinkedAt: new Date() },
  });

  await logAudit({
    organizationId: link.providerConnection.organizationId,
    actorUserId,
    action: "piraeus.bank_account_unlinked",
    objectType: "provider_account_link",
    objectId: linkId,
  });

  return updated;
}

// ---------------------------------------------------------------------
// Balance observation -- read-only, never written back to Formance.
// ---------------------------------------------------------------------

export async function observeBalance(link: { id: string; bankAccountId: string; providerConnectionId: string; externalAccountId: string }) {
  const [connection, bankAccount] = await Promise.all([
    prisma.providerConnection.findUniqueOrThrow({ where: { id: link.providerConnectionId } }),
    prisma.bankAccount.findUniqueOrThrow({ where: { id: link.bankAccountId } }),
  ]);
  const accessToken = await getValidAccessToken(link.providerConnectionId);
  const balances = await provider.getBalances({ accessToken }, link.externalAccountId);

  const rows = await prisma.$transaction(
    balances.map((balance) =>
      prisma.balanceObservation.create({
        data: {
          organizationId: connection.organizationId,
          companyId: bankAccount.companyId,
          bankAccountId: bankAccount.id,
          providerAccountLinkId: link.id,
          balanceType: balance.balanceType,
          amount: balance.amount,
          currency: balance.currency,
          observedAt: new Date(balance.observedAt),
        },
      })
    )
  );

  await logAudit({
    organizationId: connection.organizationId,
    action: "piraeus.balance_observed",
    objectType: "bank_account",
    objectId: bankAccount.id,
    metadata: { count: rows.length },
  });

  return rows;
}

// docs/13-PIRAEUS-PROVIDER.md "Balance invariant": produces a comparison,
// never mutates Formance. `null` ledgerBalance means the ledger account
// simply has no volume yet (e.g. never funded) -- not an error.
export async function compareLatestBalanceToLedger(bankAccount: BankAccount) {
  const latest = await prisma.balanceObservation.findFirst({
    where: { bankAccountId: bankAccount.id },
    orderBy: { observedAt: "desc" },
  });
  if (!latest) return null;

  const ledger = await getBankAccountBalance(bankAccount);
  return {
    observedAt: latest.observedAt,
    balanceType: latest.balanceType,
    providerAmount: latest.amount.toString(),
    ledgerAmount: ledger.balance,
    currency: latest.currency,
    matches: latest.amount.toString() === ledger.balance,
  };
}

// ---------------------------------------------------------------------
// Transaction synchronization -- idempotent, deduplicated, never
// auto-posted to Formance.
// ---------------------------------------------------------------------

const MANUAL_SYNC_COOLDOWN_SECONDS = Number(process.env.PIRAEUS_MANUAL_SYNC_COOLDOWN_SECONDS ?? "300");
const SYNC_LOOKBACK_DAYS = Number(process.env.PIRAEUS_SYNC_LOOKBACK_DAYS ?? "7");

export class SyncCooldownError extends Error {}

export async function syncTransactions(linkId: string, opts: { manual: boolean }) {
  const link = await prisma.providerAccountLink.findUniqueOrThrow({
    where: { id: linkId },
    include: { syncState: true, providerConnection: true, bankAccount: true },
  });
  if (link.status !== "ACTIVE") {
    throw new PiraeusServiceError("This provider account link is not active.");
  }

  const syncState = link.syncState ?? (await prisma.syncState.create({ data: { providerAccountLinkId: link.id } }));

  if (opts.manual && syncState.nextAllowedSyncAt && syncState.nextAllowedSyncAt > new Date()) {
    throw new SyncCooldownError(`Manual sync is on cooldown until ${syncState.nextAllowedSyncAt.toISOString()}.`);
  }

  await prisma.syncState.update({ where: { id: syncState.id }, data: { status: "SYNCING" } });

  const dateFrom = syncState.lastSyncedBookingDate
    ? syncState.lastSyncedBookingDate.toISOString().slice(0, 10)
    : new Date(Date.now() - SYNC_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const dateTo = new Date().toISOString().slice(0, 10);

  try {
    const accessToken = await getValidAccessToken(link.providerConnectionId);
    const transactions = await getTransactions(accessToken, link.externalAccountId, link.bankAccountId, { dateFrom, dateTo });

    let latestBookingDate = syncState.lastSyncedBookingDate;
    for (const tx of transactions) {
      const bookingDate = new Date(tx.bookingDate);
      if (!latestBookingDate || bookingDate > latestBookingDate) latestBookingDate = bookingDate;
    }

    // One batched insert, duplicates skipped by the DB via
    // @@unique([bankAccountId, fingerprint]) -- a repeated sync of the
    // same date range is always safe, never double-inserts.
    const { count: created } = transactions.length
      ? await prisma.externalTransaction.createMany({
          data: transactions.map((tx) => ({
            organizationId: link.providerConnection.organizationId,
            companyId: link.bankAccount.companyId,
            bankAccountId: link.bankAccountId,
            providerAccountLinkId: link.id,
            externalTransactionId: tx.externalTransactionId,
            fingerprint: tx.fingerprint,
            bookingDate: new Date(tx.bookingDate),
            valueDate: tx.valueDate ? new Date(tx.valueDate) : undefined,
            amount: tx.amount,
            currency: tx.currency,
            creditDebitIndicator: tx.creditDebitIndicator,
            remittanceInfo: tx.remittanceInfo,
            counterpartyName: tx.counterpartyName,
            counterpartyIban: tx.counterpartyIban,
            providerReferenceCode: tx.providerReferenceCode,
          })),
          skipDuplicates: true,
        })
      : { count: 0 };

    await prisma.syncState.update({
      where: { id: syncState.id },
      data: {
        status: "IDLE",
        lastSyncedAt: new Date(),
        lastSyncedBookingDate: latestBookingDate,
        consecutiveFailures: 0,
        lastError: null,
        nextAllowedSyncAt: opts.manual ? new Date(Date.now() + MANUAL_SYNC_COOLDOWN_SECONDS * 1000) : syncState.nextAllowedSyncAt,
      },
    });

    await logAudit({
      organizationId: link.providerConnection.organizationId,
      action: opts.manual ? "piraeus.manual_sync" : "piraeus.sync",
      objectType: "provider_account_link",
      objectId: link.id,
      metadata: { fetched: transactions.length, created },
    });

    return { fetched: transactions.length, created };
  } catch (err) {
    await prisma.syncState.update({
      where: { id: syncState.id },
      data: {
        status: "ERROR",
        consecutiveFailures: syncState.consecutiveFailures + 1,
        lastError: err instanceof Error ? err.message : "Sync failed.",
      },
    });
    await logAudit({
      organizationId: link.providerConnection.organizationId,
      action: "piraeus.sync_failed",
      objectType: "provider_account_link",
      objectId: link.id,
    });
    throw err;
  }
}

// Balance + transactions together -- what both the manual "sync now"
// API route and scripts/piraeus-sync-worker.ts actually call. Balance
// observation failing doesn't block the transaction sync, and vice
// versa; both errors surface, transaction sync's result is returned
// (it already carries the cooldown/active-link checks).
export async function syncLinkFully(linkId: string, opts: { manual: boolean }) {
  const link = await prisma.providerAccountLink.findUniqueOrThrow({ where: { id: linkId } });

  const balanceResult = await observeBalance(link).catch((err) => {
    console.error(JSON.stringify({ scope: "piraeus_sync", linkId, phase: "balance", error: err instanceof Error ? err.message : String(err) }));
    return null;
  });

  const transactionResult = await syncTransactions(linkId, opts);

  return { balanceObserved: balanceResult !== null, ...transactionResult };
}
