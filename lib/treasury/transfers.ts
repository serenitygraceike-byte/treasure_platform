import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import * as ledger from "@/lib/ledger/service";
import { Prisma } from "../../generated/prisma/client";
import type { BankAccount } from "../../generated/prisma/client";

type Context = {
  actorUserId: string;
  correlationId: string;
};

export class TransferValidationError extends Error {}

// Idempotent end-to-end, same pattern as createReservation. Phase 3 scope:
// the destination must be another bank account of the *same* company --
// cross-company movement is Phase 4 "Intercompany", not modeled here.
export async function createTransfer(
  bankAccount: BankAccount,
  input: { destinationAccountId: string; amount: string; idempotencyKey: string } & Context
) {
  if (input.destinationAccountId === bankAccount.id) {
    throw new TransferValidationError("A transfer cannot settle to its own source bank account.");
  }

  const existing = await prisma.bankTransfer.findUnique({
    where: {
      bankAccountId_idempotencyKey: {
        bankAccountId: bankAccount.id,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (existing) return existing;

  const destinationAccount = await prisma.bankAccount.findUnique({
    where: { id: input.destinationAccountId },
  });
  if (!destinationAccount || destinationAccount.companyId !== bankAccount.companyId) {
    throw new TransferValidationError(
      "destinationAccountId must be another bank account of the same company."
    );
  }

  const company = await prisma.company.findUniqueOrThrow({ where: { id: bankAccount.companyId } });

  const tx = await ledger.startTransfer({
    organizationId: company.organizationId,
    companyId: bankAccount.companyId,
    bankAccountId: bankAccount.id,
    asset: bankAccount.currency,
    amount: input.amount,
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
  });

  let transfer;
  try {
    transfer = await prisma.bankTransfer.create({
      data: {
        organizationId: company.organizationId,
        companyId: bankAccount.companyId,
        bankAccountId: bankAccount.id,
        destinationAccountId: destinationAccount.id,
        amount: input.amount,
        currency: bankAccount.currency,
        startLedgerTransactionId: String(tx.id),
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId,
        requestedBy: input.actorUserId,
      },
    });
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") {
      const row = await prisma.bankTransfer.findUnique({
        where: {
          bankAccountId_idempotencyKey: {
            bankAccountId: bankAccount.id,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (row) return row;
    }
    throw cause;
  }

  await logAudit({
    organizationId: company.organizationId,
    actorUserId: input.actorUserId,
    action: "bank_transfer.start",
    objectType: "bank_transfer",
    objectId: transfer.id,
    correlationId: input.correlationId,
    metadata: {
      amount: input.amount,
      currency: bankAccount.currency,
      bankAccountId: bankAccount.id,
      destinationAccountId: destinationAccount.id,
    },
  });

  return transfer;
}

export async function settleTransfer(transferId: string, input: Context) {
  const transfer = await prisma.bankTransfer.findUniqueOrThrow({ where: { id: transferId } });
  // Same reasoning as releaseReservation: IN_TRANSIT -> SETTLED happens at
  // most once, so that status change is what makes a repeat call safe.
  if (transfer.status === "SETTLED") return transfer;

  const destinationAccount = await prisma.bankAccount.findUniqueOrThrow({
    where: { id: transfer.destinationAccountId },
  });
  const company = await prisma.company.findUniqueOrThrow({ where: { id: transfer.companyId } });

  const tx = await ledger.settleTransfer({
    organizationId: company.organizationId,
    companyId: transfer.companyId,
    destinationAddress: destinationAccount.ledgerAccountAddress,
    asset: transfer.currency,
    amount: transfer.amount.toString(),
    idempotencyKey: `transfer-settle:${transfer.id}`,
    correlationId: input.correlationId,
  });

  const updated = await prisma.bankTransfer.update({
    where: { id: transferId },
    data: {
      status: "SETTLED",
      settleLedgerTransactionId: String(tx.id),
      settledAt: new Date(),
    },
  });

  await logAudit({
    organizationId: company.organizationId,
    actorUserId: input.actorUserId,
    action: "bank_transfer.settle",
    objectType: "bank_transfer",
    objectId: transfer.id,
    correlationId: input.correlationId,
  });

  return updated;
}

export async function listTransfers(companyId: string) {
  return prisma.bankTransfer.findMany({
    where: { companyId },
    orderBy: { requestedAt: "desc" },
  });
}
