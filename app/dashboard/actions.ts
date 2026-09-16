"use server";

import crypto from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canManageTreasury } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { createBankAccountSchema } from "@/lib/validation/bank-account";
import { createReservationSchema, createTransferSchema } from "@/lib/validation/treasury";
import { createBankAccount } from "@/lib/treasury/bank-accounts";
import { createReservation, releaseReservation } from "@/lib/treasury/reservations";
import { createTransfer, settleTransfer } from "@/lib/treasury/transfers";
import { LedgerError } from "@/lib/ledger/errors";

// Server Actions run as their own request -- getCurrentUser()/RBAC are
// re-checked here, not inherited from whatever rendered the form. Every
// action redirects back to the dashboard, on success or failure (an
// `error` query param carries a message the page renders as a banner --
// there's no client-side form state to show it otherwise).

function backTo(companyId: string, error?: string): never {
  const url = `/dashboard?companyId=${companyId}`;
  redirect(error ? `${url}&error=${encodeURIComponent(error)}` : url);
}

async function requireTreasuryManager(companyId: string) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) backTo(companyId, "Company not found.");

  if (!(await canManageTreasury(companyId, company.organizationId, user.id))) {
    backTo(companyId, "Only TREASURY_MANAGER, ADMIN or OWNER can do that.");
  }

  return { user, company };
}

export async function addBankAccountAction(formData: FormData) {
  const companyId = String(formData.get("companyId"));
  const { user, company } = await requireTreasuryManager(companyId);

  const parsed = createBankAccountSchema.safeParse({
    name: formData.get("name"),
    bankName: formData.get("bankName"),
    currency: formData.get("currency"),
  });
  if (!parsed.success) {
    backTo(companyId, parsed.error.issues[0]?.message ?? "Invalid bank account.");
    return;
  }

  const bankAccount = await createBankAccount({
    organizationId: company.organizationId,
    companyId,
    ...parsed.data,
  });

  await logAudit({
    organizationId: company.organizationId,
    actorUserId: user.id,
    action: "bank_account.create",
    objectType: "bank_account",
    objectId: bankAccount.id,
  });

  revalidatePath("/dashboard");
  backTo(companyId);
}

export async function reserveFundsAction(formData: FormData) {
  const companyId = String(formData.get("companyId"));
  const bankAccountId = String(formData.get("bankAccountId"));
  const { user } = await requireTreasuryManager(companyId);

  const parsed = createReservationSchema.safeParse({ amount: formData.get("amount") });
  if (!parsed.success) {
    backTo(companyId, parsed.error.issues[0]?.message ?? "Invalid amount.");
    return;
  }

  const bankAccount = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
  if (!bankAccount || bankAccount.companyId !== companyId) {
    backTo(companyId, "Bank account not found.");
    return;
  }

  try {
    await createReservation(bankAccount, {
      amount: parsed.data.amount,
      idempotencyKey: crypto.randomUUID(),
      actorUserId: user.id,
      correlationId: crypto.randomUUID(),
    });
  } catch (err) {
    backTo(companyId, err instanceof LedgerError ? err.message : "Could not reserve funds.");
    return;
  }

  revalidatePath("/dashboard");
  backTo(companyId);
}

export async function releaseReservationAction(formData: FormData) {
  const companyId = String(formData.get("companyId"));
  const reservationId = String(formData.get("reservationId"));
  const { user } = await requireTreasuryManager(companyId);

  try {
    await releaseReservation(reservationId, { actorUserId: user.id, correlationId: crypto.randomUUID() });
  } catch (err) {
    backTo(companyId, err instanceof LedgerError ? err.message : "Could not release the reservation.");
    return;
  }

  revalidatePath("/dashboard");
  backTo(companyId);
}

export async function startTransferAction(formData: FormData) {
  const companyId = String(formData.get("companyId"));
  const bankAccountId = String(formData.get("bankAccountId"));
  const { user } = await requireTreasuryManager(companyId);

  const parsed = createTransferSchema.safeParse({
    destinationAccountId: formData.get("destinationAccountId"),
    amount: formData.get("amount"),
  });
  if (!parsed.success) {
    backTo(companyId, parsed.error.issues[0]?.message ?? "Invalid transfer.");
    return;
  }

  const bankAccount = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
  if (!bankAccount || bankAccount.companyId !== companyId) {
    backTo(companyId, "Bank account not found.");
    return;
  }

  try {
    await createTransfer(bankAccount, {
      destinationAccountId: parsed.data.destinationAccountId,
      amount: parsed.data.amount,
      idempotencyKey: crypto.randomUUID(),
      actorUserId: user.id,
      correlationId: crypto.randomUUID(),
    });
  } catch (err) {
    backTo(companyId, err instanceof Error ? err.message : "Could not start the transfer.");
    return;
  }

  revalidatePath("/dashboard");
  backTo(companyId);
}

export async function settleTransferAction(formData: FormData) {
  const companyId = String(formData.get("companyId"));
  const transferId = String(formData.get("transferId"));
  const { user } = await requireTreasuryManager(companyId);

  try {
    await settleTransfer(transferId, { actorUserId: user.id, correlationId: crypto.randomUUID() });
  } catch (err) {
    backTo(companyId, err instanceof LedgerError ? err.message : "Could not settle the transfer.");
    return;
  }

  revalidatePath("/dashboard");
  backTo(companyId);
}
