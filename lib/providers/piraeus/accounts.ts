import { piraeusRequest } from "./client";
import { mapAccounts, mapBalances, mapTransactionDetail, mapTransactions } from "./mapper";
import type {
  PiraeusAccountsResponse,
  PiraeusBalancesResponse,
  PiraeusTransactionDetailResponse,
  PiraeusTransactionsResponse,
} from "./types";

// docs/13-PIRAEUS-PROVIDER.md "Assumptions": paths below follow the
// Berlin Group NextGenPSD2/XS2A shape Piraeus's AIS product is
// confirmed to implement (search-cited in that doc) -- NOT verified
// against the live PB API Accounts v1.2 portal. TODO(9A.2): correct
// against the real sandbox response/portal docs once reachable.

export async function listAccounts(accessToken: string) {
  const raw = await piraeusRequest<PiraeusAccountsResponse>({ accessToken, path: "/v1/accounts" });
  return mapAccounts(raw);
}

// Internal-only: returns the raw identifier (IBAN, falling back to the
// provider's own resourceId) for one account, to fingerprint at link
// time (lib/providers/piraeus/service.ts linkBankAccount) -- never
// returned by an API route or logged. Deliberately re-fetches rather
// than trusting anything the client could have cached/resubmitted from
// an earlier listAccounts() call.
export async function getRawAccountIdentifier(accessToken: string, externalAccountId: string): Promise<string> {
  const raw = await piraeusRequest<PiraeusAccountsResponse>({ accessToken, path: "/v1/accounts" });
  const match = raw.accounts.find((account) => account.resourceId === externalAccountId);
  if (!match) {
    throw new Error("This account is no longer visible on the connection.");
  }
  return match.iban ?? match.resourceId;
}

export async function getBalances(accessToken: string, externalAccountId: string) {
  const raw = await piraeusRequest<PiraeusBalancesResponse>({
    accessToken,
    path: `/v1/accounts/${encodeURIComponent(externalAccountId)}/balances`,
  });
  return mapBalances(raw);
}

export async function getTransactions(
  accessToken: string,
  externalAccountId: string,
  bankAccountId: string,
  range: { dateFrom: string; dateTo: string }
) {
  const raw = await piraeusRequest<PiraeusTransactionsResponse>({
    accessToken,
    path: `/v1/accounts/${encodeURIComponent(externalAccountId)}/transactions`,
    // TODO(9A.2): confirm `bookingStatus` is accepted/required by PB API
    // Accounts v1.2 the same way the general PSD2 AIS product uses it.
    query: { dateFrom: range.dateFrom, dateTo: range.dateTo, bookingStatus: "booked" },
  });
  return mapTransactions(bankAccountId, raw);
}

export async function getTransactionDetails(
  accessToken: string,
  externalAccountId: string,
  externalTransactionId: string,
  bankAccountId: string
) {
  const raw = await piraeusRequest<PiraeusTransactionDetailResponse>({
    accessToken,
    path: `/v1/accounts/${encodeURIComponent(externalAccountId)}/transactions/${encodeURIComponent(externalTransactionId)}`,
  });
  return mapTransactionDetail(bankAccountId, raw.transactionsDetails);
}
