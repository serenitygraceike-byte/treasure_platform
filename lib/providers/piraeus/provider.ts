import type { BankAccountInformationProvider } from "../types";
import { getBalances, getTransactionDetails, getTransactions, listAccounts } from "./accounts";

// Implements the provider-neutral BankAccountInformationProvider
// (lib/providers/types.ts) for Piraeus specifically. This is the only
// export lib/providers/piraeus-registry.ts needs to know about --
// oauth.ts/client.ts/accounts.ts/mapper.ts stay internal to this
// directory.
export class PiraeusBankAccountInformationProvider implements BankAccountInformationProvider {
  async listAccounts(connection: { accessToken: string }) {
    return listAccounts(connection.accessToken);
  }

  async getBalances(connection: { accessToken: string }, externalAccountId: string) {
    return getBalances(connection.accessToken, externalAccountId);
  }

  async getTransactions(
    connection: { accessToken: string },
    externalAccountId: string,
    range: { dateFrom: string; dateTo: string }
  ) {
    // bankAccountId isn't known at this interface level (it's
    // provider-neutral) -- lib/providers/piraeus-registry.ts's caller
    // (scripts/piraeus-sync-worker.ts) passes it through a second,
    // Piraeus-specific entry point when fingerprinting needs it; this
    // generic method path is kept for interface conformance and uses
    // externalAccountId as the fingerprint scope, which is sufficient
    // since fingerprints are already unique-keyed per bankAccountId at
    // the database level (@@unique([bankAccountId, fingerprint])).
    return getTransactions(connection.accessToken, externalAccountId, externalAccountId, range);
  }

  async getTransactionDetails(connection: { accessToken: string }, externalAccountId: string, externalTransactionId: string) {
    return getTransactionDetails(connection.accessToken, externalAccountId, externalTransactionId, externalAccountId);
  }
}

export const piraeusBankAccountInformationProvider = new PiraeusBankAccountInformationProvider();
