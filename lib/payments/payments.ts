import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import * as ledger from "@/lib/ledger/service";
import { counterpartyAddress } from "@/lib/ledger/accounts";
import { decryptPayoutDetails } from "@/lib/crypto/encryption";
import {
  createProviderPayment,
  getOrCreateProvider,
  providerTypeForPaymentMethod,
} from "@/lib/providers/registry";
import type { ProviderEvent } from "@/lib/providers/types";
import { Prisma } from "../../generated/prisma/client";
import type { BankAccount, Beneficiary, Company, Payment, PaymentMethod, PaymentType } from "../../generated/prisma/client";

type Context = { actorUserId: string; correlationId: string };

export class PaymentValidationError extends Error {}

// docs/05-MVP-ROADMAP.md Phase 6 "failure/retry model" -- POST
// /payments/:id/execute may be called again on a FAILED payment, each
// attempt getting its own ledger idempotency key. Not in the original
// spec; capped so a permanently-failing beneficiary can't retry forever.
const MAX_EXECUTE_RETRIES = 3;

// Idempotent end-to-end like every other create-with-idempotency-key
// function in this codebase (createIntercompanyTransfer, createTransfer).
// No ledger call here -- money only moves on execute, after approval.
export async function createPayment(
  company: Company,
  bankAccount: BankAccount,
  beneficiary: Beneficiary & { counterparty: { organizationId: string } },
  input: {
    paymentType: PaymentType;
    paymentMethod: PaymentMethod;
    amount: string;
    currency: string;
    idempotencyKey: string;
  } & Context
) {
  if (beneficiary.counterparty.organizationId !== company.organizationId) {
    throw new PaymentValidationError("beneficiaryId must belong to a counterparty in the same organization.");
  }
  if (bankAccount.companyId !== company.id) {
    throw new PaymentValidationError("bankAccountId must belong to the same company.");
  }
  if (input.paymentMethod !== beneficiary.paymentMethod) {
    throw new PaymentValidationError(
      `This beneficiary is set up for ${beneficiary.paymentMethod}, not ${input.paymentMethod}.`
    );
  }
  if (bankAccount.currency !== input.currency) {
    throw new PaymentValidationError("bankAccountId currency must match the payment currency -- no FX support.");
  }

  const existing = await prisma.payment.findUnique({
    where: { companyId_idempotencyKey: { companyId: company.id, idempotencyKey: input.idempotencyKey } },
  });
  if (existing) return existing;

  let payment: Payment;
  try {
    payment = await prisma.payment.create({
      data: {
        organizationId: company.organizationId,
        companyId: company.id,
        beneficiaryId: beneficiary.id,
        counterpartyId: beneficiary.counterpartyId,
        bankAccountId: bankAccount.id,
        amount: input.amount,
        currency: input.currency,
        paymentType: input.paymentType,
        paymentMethod: input.paymentMethod,
        idempotencyKey: input.idempotencyKey,
        requestedBy: input.actorUserId,
      },
    });
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") {
      const row = await prisma.payment.findUnique({
        where: { companyId_idempotencyKey: { companyId: company.id, idempotencyKey: input.idempotencyKey } },
      });
      if (row) return row;
    }
    throw cause;
  }

  await logAudit({
    organizationId: company.organizationId,
    actorUserId: input.actorUserId,
    action: "payment.create",
    objectType: "payment",
    objectId: payment.id,
    correlationId: input.correlationId,
    metadata: { amount: input.amount, currency: input.currency, paymentMethod: input.paymentMethod },
  });

  return payment;
}

export async function approvePayment(id: string, ctx: Context) {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id } });
  if (payment.status !== "PENDING_APPROVAL") return payment;

  const updated = await prisma.payment.update({
    where: { id },
    data: { status: "APPROVED", approvedBy: ctx.actorUserId, approvedAt: new Date() },
  });

  await logAudit({
    organizationId: payment.organizationId,
    actorUserId: ctx.actorUserId,
    action: "payment.approve",
    objectType: "payment",
    objectId: id,
    correlationId: ctx.correlationId,
  });

  return updated;
}

export async function rejectPayment(id: string, ctx: Context, reason?: string) {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id } });
  if (payment.status !== "PENDING_APPROVAL") return payment;

  const updated = await prisma.payment.update({
    where: { id },
    data: { status: "REJECTED", failureReason: reason },
  });

  await logAudit({
    organizationId: payment.organizationId,
    actorUserId: ctx.actorUserId,
    action: "payment.reject",
    objectType: "payment",
    objectId: id,
    correlationId: ctx.correlationId,
    metadata: reason ? { reason } : undefined,
  });

  return updated;
}

export async function cancelPayment(id: string, ctx: Context) {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id } });
  if (payment.status === "CANCELLED") return payment;
  if (payment.status !== "PENDING_APPROVAL" && payment.status !== "APPROVED") {
    throw new PaymentValidationError("A payment can only be cancelled before it is executed.");
  }

  const updated = await prisma.payment.update({ where: { id }, data: { status: "CANCELLED" } });

  await logAudit({
    organizationId: payment.organizationId,
    actorUserId: ctx.actorUserId,
    action: "payment.cancel",
    objectType: "payment",
    objectId: id,
    correlationId: ctx.correlationId,
  });

  return updated;
}

// docs/02-LEDGER-SPEC.md pattern C (BANK -> IN_TRANSIT), then either an
// immediate settle (MANUAL, or a provider that resolves synchronously),
// PROCESSING (provider is async -- a webhook resolves it later), or an
// immediate reversal back to BANK on synchronous failure. Retriable from
// FAILED up to MAX_EXECUTE_RETRIES, each attempt its own ledger
// idempotency key.
export async function executePayment(id: string, ctx: Context) {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id } });

  if (payment.status === "PROCESSING" || payment.status === "SETTLED") return payment;
  if (payment.status === "PENDING_APPROVAL" || payment.status === "REJECTED" || payment.status === "CANCELLED") {
    throw new PaymentValidationError(`A payment in status ${payment.status} cannot be executed.`);
  }
  if (payment.status === "FAILED" && payment.retryCount >= MAX_EXECUTE_RETRIES) {
    throw new PaymentValidationError(`Retry limit (${MAX_EXECUTE_RETRIES}) reached for this payment.`);
  }

  const [bankAccount, beneficiary] = await Promise.all([
    prisma.bankAccount.findUniqueOrThrow({ where: { id: payment.bankAccountId } }),
    prisma.beneficiary.findUniqueOrThrow({ where: { id: payment.beneficiaryId } }),
  ]);

  const attempt = payment.status === "FAILED" ? payment.retryCount + 1 : 0;
  const startTx = await ledger.startTransfer({
    organizationId: payment.organizationId,
    companyId: payment.companyId,
    bankAccountId: bankAccount.id,
    asset: payment.currency,
    amount: payment.amount.toString(),
    idempotencyKey: `payment-execute:${payment.id}:${attempt}`,
    correlationId: ctx.correlationId,
  });

  const destination = counterpartyAddress(payment.organizationId, beneficiary.counterpartyId, payment.currency);

  if (payment.paymentMethod === "MANUAL") {
    const settleTx = await ledger.settleTransfer({
      organizationId: payment.organizationId,
      companyId: payment.companyId,
      destinationAddress: destination,
      asset: payment.currency,
      amount: payment.amount.toString(),
      idempotencyKey: `payment-settle:${payment.id}:${attempt}`,
      correlationId: ctx.correlationId,
    });
    return finalizeExecute(payment, ctx, {
      status: "SETTLED",
      ledgerTransactionId: String(startTx.id),
      settleLedgerTransactionId: String(settleTx.id),
      executedAt: new Date(),
      settledAt: new Date(),
    });
  }

  const providerType = providerTypeForPaymentMethod(payment.paymentMethod);
  if (!providerType) {
    throw new PaymentValidationError(`No provider is configured for payment method ${payment.paymentMethod}.`);
  }
  const provider = await getOrCreateProvider(payment.organizationId, providerType);
  const payoutDetails = decryptPayoutDetails(beneficiary.payoutDetailsEncrypted);

  const providerPayment = await createProviderPayment(providerType, {
    reference: payment.id,
    amount: payment.amount.toString(),
    asset: payment.currency,
    payoutDetails,
  });

  if (providerPayment.status === "SUCCEEDED") {
    const settleTx = await ledger.settleTransfer({
      organizationId: payment.organizationId,
      companyId: payment.companyId,
      destinationAddress: destination,
      asset: payment.currency,
      amount: payment.amount.toString(),
      idempotencyKey: `payment-settle:${payment.id}:${attempt}`,
      correlationId: ctx.correlationId,
    });
    return finalizeExecute(payment, ctx, {
      status: "SETTLED",
      providerId: provider.id,
      providerPaymentId: providerPayment.providerPaymentId,
      ledgerTransactionId: String(startTx.id),
      settleLedgerTransactionId: String(settleTx.id),
      executedAt: new Date(),
      settledAt: new Date(),
    });
  }

  if (providerPayment.status === "PENDING") {
    return finalizeExecute(payment, ctx, {
      status: "PROCESSING",
      providerId: provider.id,
      providerPaymentId: providerPayment.providerPaymentId,
      ledgerTransactionId: String(startTx.id),
      executedAt: new Date(),
    });
  }

  const reverseTx = await ledger.reverseTransfer({
    organizationId: payment.organizationId,
    companyId: payment.companyId,
    bankAccountId: bankAccount.id,
    asset: payment.currency,
    amount: payment.amount.toString(),
    idempotencyKey: `payment-reverse:${payment.id}:${attempt}`,
    correlationId: ctx.correlationId,
  });
  return finalizeExecute(payment, ctx, {
    status: "FAILED",
    providerId: provider.id,
    providerPaymentId: providerPayment.providerPaymentId,
    ledgerTransactionId: String(startTx.id),
    settleLedgerTransactionId: String(reverseTx.id),
    executedAt: new Date(),
    failureCode: providerPayment.failureCode,
    failureReason: providerPayment.failureReason,
    retryCount: attempt,
  });
}

async function finalizeExecute(
  payment: Payment,
  ctx: Context,
  data: Partial<Payment>
) {
  const updated = await prisma.payment.update({ where: { id: payment.id }, data });

  await logAudit({
    organizationId: payment.organizationId,
    actorUserId: ctx.actorUserId,
    action: data.status === "SETTLED" ? "payment.settle" : data.status === "FAILED" ? "payment.fail" : "payment.execute",
    objectType: "payment",
    objectId: payment.id,
    correlationId: ctx.correlationId,
    metadata: { status: data.status, failureCode: data.failureCode },
  });

  return updated;
}

// Called by lib/providers/webhook.ts once a webhook's signature is
// verified and it's not a duplicate. Idempotent on payment.status --
// only a PROCESSING payment transitions; a repeat delivery of the same
// (already-handled) event is a no-op here (the dedup itself already
// happened one layer up).
export async function handlePaymentSettled(event: ProviderEvent, ctx: { correlationId: string }) {
  const payment = await prisma.payment.findFirst({ where: { providerPaymentId: event.providerPaymentId } });
  if (!payment || payment.status !== "PROCESSING") return payment;

  const beneficiary = await prisma.beneficiary.findUniqueOrThrow({ where: { id: payment.beneficiaryId } });
  const destination = counterpartyAddress(payment.organizationId, beneficiary.counterpartyId, payment.currency);

  const settleTx = await ledger.settleTransfer({
    organizationId: payment.organizationId,
    companyId: payment.companyId,
    destinationAddress: destination,
    asset: payment.currency,
    amount: payment.amount.toString(),
    idempotencyKey: `payment-settle:${payment.id}:webhook`,
    correlationId: ctx.correlationId,
  });

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "SETTLED", settleLedgerTransactionId: String(settleTx.id), settledAt: new Date() },
  });

  await logAudit({
    organizationId: payment.organizationId,
    actorUserId: null,
    action: "payment.settle",
    objectType: "payment",
    objectId: payment.id,
    correlationId: ctx.correlationId,
    metadata: { via: "webhook" },
  });

  return updated;
}

export async function handlePaymentFailed(event: ProviderEvent, ctx: { correlationId: string }) {
  const payment = await prisma.payment.findFirst({ where: { providerPaymentId: event.providerPaymentId } });
  if (!payment || payment.status !== "PROCESSING") return payment;

  const bankAccount = await prisma.bankAccount.findUniqueOrThrow({ where: { id: payment.bankAccountId } });

  const reverseTx = await ledger.reverseTransfer({
    organizationId: payment.organizationId,
    companyId: payment.companyId,
    bankAccountId: bankAccount.id,
    asset: payment.currency,
    amount: payment.amount.toString(),
    idempotencyKey: `payment-reverse:${payment.id}:webhook`,
    correlationId: ctx.correlationId,
  });

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: "FAILED",
      settleLedgerTransactionId: String(reverseTx.id),
      failureCode: event.failureCode,
      failureReason: event.failureReason,
      retryCount: payment.retryCount + 1,
    },
  });

  await logAudit({
    organizationId: payment.organizationId,
    actorUserId: null,
    action: "payment.fail",
    objectType: "payment",
    objectId: payment.id,
    correlationId: ctx.correlationId,
    metadata: { via: "webhook", failureCode: event.failureCode },
  });

  return updated;
}

export async function getPayment(id: string) {
  return prisma.payment.findUnique({ where: { id } });
}

export async function listPayments(companyId: string) {
  return prisma.payment.findMany({ where: { companyId }, orderBy: { createdAt: "desc" } });
}
