import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import * as ledger from "@/lib/ledger/service";
import { Prisma } from "../../generated/prisma/client";
import type { BankAccount } from "../../generated/prisma/client";

type Context = {
  actorUserId: string;
  correlationId: string;
};

export class IntercompanyValidationError extends Error {}

// Idempotent end-to-end, same pattern as lib/treasury/transfers.ts's
// createTransfer -- the only difference is the cross-company/currency
// validation and that no ledger call happens until approval.
export async function createIntercompanyTransfer(
  sourceBankAccount: BankAccount,
  input: {
    toCompanyId: string;
    destinationAccountId: string;
    amount: string;
    purpose?: string;
    dueAt?: string;
    idempotencyKey: string;
  } & Context
) {
  const fromCompany = await prisma.company.findUniqueOrThrow({
    where: { id: sourceBankAccount.companyId },
  });

  if (input.toCompanyId === sourceBankAccount.companyId) {
    throw new IntercompanyValidationError("fromCompanyId and toCompanyId must differ.");
  }

  const toCompany = await prisma.company.findUnique({ where: { id: input.toCompanyId } });
  if (!toCompany || toCompany.organizationId !== fromCompany.organizationId) {
    throw new IntercompanyValidationError("toCompanyId must be a company in the same organization.");
  }

  const destinationAccount = await prisma.bankAccount.findUnique({
    where: { id: input.destinationAccountId },
  });
  if (!destinationAccount || destinationAccount.companyId !== input.toCompanyId) {
    throw new IntercompanyValidationError(
      "destinationAccountId must be a bank account of toCompanyId."
    );
  }
  if (destinationAccount.currency !== sourceBankAccount.currency) {
    throw new IntercompanyValidationError(
      "Source and destination bank accounts must share a currency -- FX conversion is not supported."
    );
  }

  const existing = await prisma.intercompanyTransfer.findUnique({
    where: {
      bankAccountId_idempotencyKey: {
        bankAccountId: sourceBankAccount.id,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (existing) return existing;

  let transfer;
  try {
    transfer = await prisma.intercompanyTransfer.create({
      data: {
        organizationId: fromCompany.organizationId,
        fromCompanyId: fromCompany.id,
        toCompanyId: toCompany.id,
        bankAccountId: sourceBankAccount.id,
        destinationAccountId: destinationAccount.id,
        amount: input.amount,
        currency: sourceBankAccount.currency,
        purpose: input.purpose,
        dueAt: input.dueAt,
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId,
        requestedBy: input.actorUserId,
      },
    });
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") {
      const row = await prisma.intercompanyTransfer.findUnique({
        where: {
          bankAccountId_idempotencyKey: {
            bankAccountId: sourceBankAccount.id,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (row) return row;
    }
    throw cause;
  }

  await logAudit({
    organizationId: fromCompany.organizationId,
    actorUserId: input.actorUserId,
    action: "intercompany_transfer.create",
    objectType: "intercompany_transfer",
    objectId: transfer.id,
    correlationId: input.correlationId,
    metadata: {
      amount: input.amount,
      currency: sourceBankAccount.currency,
      fromCompanyId: fromCompany.id,
      toCompanyId: toCompany.id,
    },
  });

  return transfer;
}

export async function approveIntercompanyTransfer(id: string, ctx: Context) {
  const transfer = await prisma.intercompanyTransfer.findUniqueOrThrow({ where: { id } });
  if (transfer.status !== "PENDING_APPROVAL") return transfer;

  const destinationAccount = await prisma.bankAccount.findUniqueOrThrow({
    where: { id: transfer.destinationAccountId },
  });

  const startTx = await ledger.startTransfer({
    organizationId: transfer.organizationId,
    companyId: transfer.fromCompanyId,
    bankAccountId: transfer.bankAccountId,
    asset: transfer.currency,
    amount: transfer.amount.toString(),
    idempotencyKey: `intercompany-start:${transfer.id}`,
    correlationId: ctx.correlationId,
  });

  const settleTx = await ledger.settleTransfer({
    organizationId: transfer.organizationId,
    companyId: transfer.fromCompanyId,
    destinationAddress: destinationAccount.ledgerAccountAddress,
    asset: transfer.currency,
    amount: transfer.amount.toString(),
    idempotencyKey: `intercompany-settle:${transfer.id}`,
    correlationId: ctx.correlationId,
  });

  const now = new Date();
  const updated = await prisma.intercompanyTransfer.update({
    where: { id },
    data: {
      status: "APPROVED",
      startLedgerTransactionId: String(startTx.id),
      settleLedgerTransactionId: String(settleTx.id),
      approvedBy: ctx.actorUserId,
      sentAt: now,
      receivedAt: now,
    },
  });

  await logAudit({
    organizationId: transfer.organizationId,
    actorUserId: ctx.actorUserId,
    action: "intercompany_transfer.approve",
    objectType: "intercompany_transfer",
    objectId: transfer.id,
    correlationId: ctx.correlationId,
  });

  return updated;
}

export async function rejectIntercompanyTransfer(id: string, ctx: Context, reason?: string) {
  const transfer = await prisma.intercompanyTransfer.findUniqueOrThrow({ where: { id } });
  if (transfer.status !== "PENDING_APPROVAL") return transfer;

  const updated = await prisma.intercompanyTransfer.update({
    where: { id },
    data: {
      status: "REJECTED",
      rejectedBy: ctx.actorUserId,
      rejectedAt: new Date(),
      rejectionReason: reason,
    },
  });

  await logAudit({
    organizationId: transfer.organizationId,
    actorUserId: ctx.actorUserId,
    action: "intercompany_transfer.reject",
    objectType: "intercompany_transfer",
    objectId: transfer.id,
    correlationId: ctx.correlationId,
    metadata: reason ? { reason } : undefined,
  });

  return updated;
}

export async function reconcileIntercompanyTransfer(id: string, ctx: Context) {
  const transfer = await prisma.intercompanyTransfer.findUniqueOrThrow({ where: { id } });
  if (transfer.reconciledAt) return transfer;
  if (transfer.status !== "APPROVED") {
    throw new IntercompanyValidationError("Only an approved transfer can be reconciled.");
  }

  const updated = await prisma.intercompanyTransfer.update({
    where: { id },
    data: { reconciledAt: new Date() },
  });

  await logAudit({
    organizationId: transfer.organizationId,
    actorUserId: ctx.actorUserId,
    action: "intercompany_transfer.reconcile",
    objectType: "intercompany_transfer",
    objectId: transfer.id,
    correlationId: ctx.correlationId,
  });

  return updated;
}

export async function listIntercompanyTransfers(companyId: string) {
  return prisma.intercompanyTransfer.findMany({
    where: { OR: [{ fromCompanyId: companyId }, { toCompanyId: companyId }] },
    orderBy: { requestedAt: "desc" },
  });
}
