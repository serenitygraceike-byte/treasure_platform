import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { bankAddress } from "@/lib/ledger/accounts";
import type { BankAccountStatus } from "../../generated/prisma/client";

export async function listBankAccounts(companyId: string) {
  return prisma.bankAccount.findMany({
    where: { companyId },
    orderBy: { createdAt: "asc" },
  });
}

export async function getBankAccount(id: string) {
  return prisma.bankAccount.findUnique({ where: { id } });
}

// The ledger address is deterministic (lib/ledger/accounts.ts bankAddress)
// but needs the row's own id as one of its segments — generated here
// client-side so it can be computed and stored in the same insert.
export async function createBankAccount(input: {
  organizationId: string;
  companyId: string;
  name: string;
  bankName: string;
  iban?: string;
  accountNumberLast4?: string;
  currency: string;
}) {
  const id = crypto.randomUUID();
  const ledgerAccountAddress = bankAddress(
    input.organizationId,
    input.companyId,
    id,
    input.currency
  );
  return prisma.bankAccount.create({
    data: {
      id,
      companyId: input.companyId,
      name: input.name,
      bankName: input.bankName,
      iban: input.iban,
      accountNumberLast4: input.accountNumberLast4,
      currency: input.currency,
      ledgerAccountAddress,
    },
  });
}

export async function updateBankAccount(
  id: string,
  data: Partial<{
    name: string;
    bankName: string;
    iban: string | null;
    accountNumberLast4: string | null;
    status: BankAccountStatus;
  }>
) {
  return prisma.bankAccount.update({ where: { id }, data });
}
