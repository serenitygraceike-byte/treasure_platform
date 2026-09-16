import { getAccountBalance } from "@/lib/ledger/service";
import type { BankAccount } from "../../generated/prisma/client";

// Thin wrapper so callers (dashboard, future balance endpoints) don't
// need to know a BankAccount's ledger address is the thing to query.
export async function getBankAccountBalance(bankAccount: BankAccount) {
  return getAccountBalance(bankAccount.ledgerAccountAddress, bankAccount.currency);
}
