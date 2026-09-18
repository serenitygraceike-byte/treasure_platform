import { fingerprintTransactionFallback, maskAccountIdentifier } from "@/lib/crypto/encryption";
import type { NormalizedAccount, NormalizedBalance, NormalizedTransaction } from "../types";
import type {
  PiraeusAccountsResponse,
  PiraeusBalancesResponse,
  PiraeusTransaction,
  PiraeusTransactionsResponse,
} from "./types";

// The only file that reads lib/providers/piraeus/types.ts's raw shapes
// and produces lib/providers/types.ts's normalized ones -- per the
// task brief, "provider-specific Piraeus response structures must not
// escape the Piraeus adapter."

export function mapAccounts(raw: PiraeusAccountsResponse): NormalizedAccount[] {
  return raw.accounts.map((account) => ({
    externalAccountId: account.resourceId,
    maskedIdentifier: maskAccountIdentifier(account.iban ?? account.resourceId),
    currency: account.currency,
    name: account.name,
  }));
}

export function mapBalances(raw: PiraeusBalancesResponse): NormalizedBalance[] {
  return raw.balances.map((balance) => ({
    balanceType: balance.balanceType,
    amount: balance.balanceAmount.amount,
    currency: balance.balanceAmount.currency,
    observedAt: balance.referenceDate ?? balance.lastChangeDateTime ?? new Date().toISOString(),
  }));
}

function mapOne(bankAccountId: string, raw: PiraeusTransaction): NormalizedTransaction {
  const creditDebitIndicator: "CREDIT" | "DEBIT" = raw.transactionAmount.amount.startsWith("-") ? "DEBIT" : "CREDIT";
  const stableId = raw.transactionId ?? raw.entryReference;
  const fingerprint =
    stableId ??
    fingerprintTransactionFallback([
      bankAccountId,
      raw.bookingDate,
      raw.transactionAmount.amount,
      raw.transactionAmount.currency,
      raw.remittanceInformationUnstructured ?? "",
    ]);

  const counterparty = creditDebitIndicator === "DEBIT" ? raw.creditorAccount : raw.debtorAccount;
  const counterpartyName = creditDebitIndicator === "DEBIT" ? raw.creditorName : raw.debtorName;

  return {
    externalTransactionId: stableId,
    fingerprint,
    bookingDate: raw.bookingDate,
    valueDate: raw.valueDate,
    amount: raw.transactionAmount.amount,
    currency: raw.transactionAmount.currency,
    creditDebitIndicator,
    remittanceInfo: raw.remittanceInformationUnstructured,
    counterpartyName,
    counterpartyIban: counterparty?.iban,
    providerReferenceCode: raw.proprietaryBankTransactionCode,
  };
}

export function mapTransactions(bankAccountId: string, raw: PiraeusTransactionsResponse): NormalizedTransaction[] {
  const booked = raw.transactions.booked ?? [];
  return booked.map((tx) => mapOne(bankAccountId, tx));
}

export function mapTransactionDetail(bankAccountId: string, raw: PiraeusTransaction): NormalizedTransaction {
  return mapOne(bankAccountId, raw);
}
