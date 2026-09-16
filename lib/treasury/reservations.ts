import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import * as ledger from "@/lib/ledger/service";
import { Prisma } from "../../generated/prisma/client";
import type { BankAccount } from "../../generated/prisma/client";

type Context = {
  actorUserId: string;
  correlationId: string;
};

// Idempotent end-to-end: a retried (bankAccountId, idempotencyKey) pair
// returns the row already on disk instead of calling Formance again.
export async function createReservation(
  bankAccount: BankAccount,
  input: { amount: string; idempotencyKey: string } & Context
) {
  const existing = await prisma.bankReservation.findUnique({
    where: {
      bankAccountId_idempotencyKey: {
        bankAccountId: bankAccount.id,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (existing) return existing;

  const company = await prisma.company.findUniqueOrThrow({ where: { id: bankAccount.companyId } });

  const tx = await ledger.reserveFunds({
    organizationId: company.organizationId,
    companyId: bankAccount.companyId,
    bankAccountId: bankAccount.id,
    asset: bankAccount.currency,
    amount: input.amount,
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
  });

  let reservation;
  try {
    reservation = await prisma.bankReservation.create({
      data: {
        organizationId: company.organizationId,
        companyId: bankAccount.companyId,
        bankAccountId: bankAccount.id,
        amount: input.amount,
        currency: bankAccount.currency,
        ledgerTransactionId: String(tx.id),
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId,
        requestedBy: input.actorUserId,
      },
    });
  } catch (cause) {
    // Concurrent retry raced us to the insert -- Formance already made this
    // idempotent (same tx above); return the row the other request wrote.
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") {
      const row = await prisma.bankReservation.findUnique({
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
    action: "bank_reservation.create",
    objectType: "bank_reservation",
    objectId: reservation.id,
    correlationId: input.correlationId,
    metadata: { amount: input.amount, currency: bankAccount.currency, bankAccountId: bankAccount.id },
  });

  return reservation;
}

export async function releaseReservation(reservationId: string, input: Context) {
  const reservation = await prisma.bankReservation.findUniqueOrThrow({ where: { id: reservationId } });
  // A reservation can only ever transition ACTIVE -> RELEASED once, so
  // that status change (not a client-supplied key) is what makes a repeat
  // call safe -- the Formance call below still needs *a* key, deterministic
  // and derived from the row itself rather than asked of the caller.
  if (reservation.status === "RELEASED") return reservation;

  const bankAccount = await prisma.bankAccount.findUniqueOrThrow({
    where: { id: reservation.bankAccountId },
  });
  const company = await prisma.company.findUniqueOrThrow({ where: { id: bankAccount.companyId } });

  const tx = await ledger.releaseReservation({
    organizationId: company.organizationId,
    companyId: bankAccount.companyId,
    bankAccountId: bankAccount.id,
    asset: bankAccount.currency,
    amount: reservation.amount.toString(),
    idempotencyKey: `reservation-release:${reservation.id}`,
    correlationId: input.correlationId,
  });

  const updated = await prisma.bankReservation.update({
    where: { id: reservationId },
    data: {
      status: "RELEASED",
      releaseLedgerTransactionId: String(tx.id),
      releasedAt: new Date(),
    },
  });

  await logAudit({
    organizationId: company.organizationId,
    actorUserId: input.actorUserId,
    action: "bank_reservation.release",
    objectType: "bank_reservation",
    objectId: reservation.id,
    correlationId: input.correlationId,
  });

  return updated;
}

export async function listReservations(companyId: string) {
  return prisma.bankReservation.findMany({
    where: { companyId },
    orderBy: { requestedAt: "desc" },
  });
}
