"use server";

import crypto from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canApproveIntercompany, canManageTreasury } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { createBankAccountSchema } from "@/lib/validation/bank-account";
import { createReservationSchema, createTransferSchema } from "@/lib/validation/treasury";
import { createIntercompanyTransferSchema } from "@/lib/validation/intercompany";
import { createBankAccount } from "@/lib/treasury/bank-accounts";
import { createReservation, releaseReservation } from "@/lib/treasury/reservations";
import { createTransfer, settleTransfer } from "@/lib/treasury/transfers";
import {
  approveIntercompanyTransfer,
  createIntercompanyTransfer,
  reconcileIntercompanyTransfer,
  rejectIntercompanyTransfer,
} from "@/lib/treasury/intercompany";
import { LedgerError } from "@/lib/ledger/errors";
import { canApproveExpense, canManageExpenses, isOrgManager } from "@/lib/rbac";
import { createExpenseCategorySchema, createExpenseSchema } from "@/lib/validation/expense";
import { upsertBudgetSchema } from "@/lib/validation/budget";
import { createExpenseCategory } from "@/lib/expenses/categories";
import { approveExpense, createExpense } from "@/lib/expenses/expenses";
import { upsertBudget } from "@/lib/expenses/budgets";
import { canApprovePayment, canRequestPayment } from "@/lib/rbac";
import { createCounterpartySchema, createBeneficiarySchema } from "@/lib/validation/counterparty";
import { createPaymentSchema } from "@/lib/validation/payment";
import { createBeneficiary, createCounterparty } from "@/lib/counterparties";
import {
  approvePayment,
  cancelPayment,
  createPayment,
  executePayment,
  PaymentValidationError,
  rejectPayment,
} from "@/lib/payments/payments";
import { simulateProviderWebhook } from "@/lib/providers/simulate";

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

// Approval spans two companies (see lib/rbac.ts canApproveIntercompany) --
// checked at the org level, not against the company currently shown on
// the dashboard. companyId here is only where to redirect back to.
async function requireIntercompanyApprover(organizationId: string, companyId: string) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!(await canApproveIntercompany(organizationId, user.id))) {
    backTo(companyId, "Only an org-level APPROVER, ADMIN or OWNER can do that.");
  }
  return user;
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

// destinationAccountId alone determines toCompanyId (looked up below) --
// the dashboard's single "destination account" picker lists bank
// accounts of every other company in the org, avoiding a cascading
// company -> account client-side dropdown.
export async function initiateIntercompanyTransferAction(formData: FormData) {
  const companyId = String(formData.get("companyId"));
  const bankAccountId = String(formData.get("bankAccountId"));
  const { user } = await requireTreasuryManager(companyId);

  const parsed = createIntercompanyTransferSchema
    .pick({ destinationAccountId: true, amount: true, purpose: true })
    .safeParse({
      destinationAccountId: formData.get("destinationAccountId"),
      amount: formData.get("amount"),
      purpose: formData.get("purpose") || undefined,
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

  const destinationAccount = await prisma.bankAccount.findUnique({
    where: { id: parsed.data.destinationAccountId },
  });
  if (!destinationAccount) {
    backTo(companyId, "Destination bank account not found.");
    return;
  }

  try {
    await createIntercompanyTransfer(bankAccount, {
      toCompanyId: destinationAccount.companyId,
      destinationAccountId: destinationAccount.id,
      amount: parsed.data.amount,
      purpose: parsed.data.purpose,
      idempotencyKey: crypto.randomUUID(),
      actorUserId: user.id,
      correlationId: crypto.randomUUID(),
    });
  } catch (err) {
    backTo(companyId, err instanceof Error ? err.message : "Could not request the transfer.");
    return;
  }

  revalidatePath("/dashboard");
  backTo(companyId);
}

export async function approveIntercompanyTransferAction(formData: FormData) {
  const companyId = String(formData.get("companyId"));
  const transferId = String(formData.get("transferId"));

  const transfer = await prisma.intercompanyTransfer.findUnique({ where: { id: transferId } });
  if (!transfer) {
    backTo(companyId, "Intercompany transfer not found.");
    return;
  }
  const user = await requireIntercompanyApprover(transfer.organizationId, companyId);

  try {
    await approveIntercompanyTransfer(transferId, {
      actorUserId: user.id,
      correlationId: crypto.randomUUID(),
    });
  } catch (err) {
    backTo(companyId, err instanceof LedgerError ? err.message : "Could not approve the transfer.");
    return;
  }

  revalidatePath("/dashboard");
  backTo(companyId);
}

export async function rejectIntercompanyTransferAction(formData: FormData) {
  const companyId = String(formData.get("companyId"));
  const transferId = String(formData.get("transferId"));

  const transfer = await prisma.intercompanyTransfer.findUnique({ where: { id: transferId } });
  if (!transfer) {
    backTo(companyId, "Intercompany transfer not found.");
    return;
  }
  const user = await requireIntercompanyApprover(transfer.organizationId, companyId);

  await rejectIntercompanyTransfer(
    transferId,
    { actorUserId: user.id, correlationId: crypto.randomUUID() },
    (formData.get("reason") as string) || undefined
  );

  revalidatePath("/dashboard");
  backTo(companyId);
}

export async function reconcileIntercompanyTransferAction(formData: FormData) {
  const companyId = String(formData.get("companyId"));
  const transferId = String(formData.get("transferId"));
  const { user } = await requireTreasuryManager(companyId);

  try {
    await reconcileIntercompanyTransfer(transferId, {
      actorUserId: user.id,
      correlationId: crypto.randomUUID(),
    });
  } catch (err) {
    backTo(companyId, err instanceof Error ? err.message : "Could not reconcile the transfer.");
    return;
  }

  revalidatePath("/dashboard");
  backTo(companyId);
}

// ---------------------------------------------------------------------
// Phase 5 — OPEX (docs/05-MVP-ROADMAP.md). Categories are org-scoped
// (isOrgManager), expenses/budgets are company-scoped (canManageExpenses/
// canApproveExpense) -- same split as the API routes under
// app/api/v1/expense-categories and app/api/v1/expenses.
// ---------------------------------------------------------------------

async function requireExpenseManager(companyId: string) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) backTo(companyId, "Company not found.");

  if (!(await canManageExpenses(companyId, company.organizationId, user.id))) {
    backTo(companyId, "Only ACCOUNTANT, ADMIN or OWNER can do that.");
  }

  return { user, company };
}

export async function addExpenseCategoryAction(formData: FormData) {
  const companyId = String(formData.get("companyId"));
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) backTo(companyId, "Company not found.");

  if (!(await isOrgManager(company.organizationId, user.id))) {
    backTo(companyId, "Only ADMIN or OWNER can manage expense categories.");
    return;
  }

  const parsed = createExpenseCategorySchema.safeParse({
    code: formData.get("code"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    backTo(companyId, parsed.error.issues[0]?.message ?? "Invalid category.");
    return;
  }

  await createExpenseCategory(company.organizationId, parsed.data, {
    actorUserId: user.id,
    correlationId: crypto.randomUUID(),
  });

  revalidatePath("/dashboard");
  backTo(companyId);
}

export async function addExpenseAction(formData: FormData) {
  const companyId = String(formData.get("companyId"));
  const { user, company } = await requireExpenseManager(companyId);

  const parsed = createExpenseSchema.safeParse({
    companyId,
    categoryId: formData.get("categoryId"),
    amount: formData.get("amount"),
    currency: formData.get("currency"),
    recurrence: formData.get("recurrence") || "ONE_OFF",
    dueDate: formData.get("dueDate"),
  });
  if (!parsed.success) {
    backTo(companyId, parsed.error.issues[0]?.message ?? "Invalid expense.");
    return;
  }

  try {
    await createExpense(company, {
      ...parsed.data,
      actorUserId: user.id,
      correlationId: crypto.randomUUID(),
    });
  } catch (err) {
    backTo(companyId, err instanceof Error ? err.message : "Could not record the expense.");
    return;
  }

  revalidatePath("/dashboard");
  backTo(companyId);
}

export async function approveExpenseAction(formData: FormData) {
  const companyId = String(formData.get("companyId"));
  const expenseId = String(formData.get("expenseId"));
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) backTo(companyId, "Company not found.");

  if (!(await canApproveExpense(companyId, company.organizationId, user.id))) {
    backTo(companyId, "Only an APPROVER, ADMIN or OWNER can approve an expense.");
    return;
  }

  await approveExpense(expenseId, { actorUserId: user.id, correlationId: crypto.randomUUID() });

  revalidatePath("/dashboard");
  backTo(companyId);
}

export async function setBudgetAction(formData: FormData) {
  const companyId = String(formData.get("companyId"));
  const { user, company } = await requireExpenseManager(companyId);

  const now = new Date();
  const parsed = upsertBudgetSchema.safeParse({
    categoryId: formData.get("categoryId"),
    periodYear: formData.get("periodYear") || now.getUTCFullYear(),
    periodMonth: formData.get("periodMonth") || now.getUTCMonth() + 1,
    amount: formData.get("amount"),
    currency: formData.get("currency"),
  });
  if (!parsed.success) {
    backTo(companyId, parsed.error.issues[0]?.message ?? "Invalid budget.");
    return;
  }

  try {
    await upsertBudget(company, {
      ...parsed.data,
      actorUserId: user.id,
      correlationId: crypto.randomUUID(),
    });
  } catch (err) {
    backTo(companyId, err instanceof Error ? err.message : "Could not set the budget.");
    return;
  }

  revalidatePath("/dashboard");
  backTo(companyId);
}

// ---------------------------------------------------------------------
// Phase 6 — Payment orchestration (docs/05-MVP-ROADMAP.md). Counterparties
// are org-scoped (isOrgManager, same as expense categories), requesting/
// approving/executing a payment is company-scoped (canRequestPayment/
// canApprovePayment/canManageTreasury) -- same split as the API routes.
// ---------------------------------------------------------------------

export async function addCounterpartyAction(formData: FormData) {
  const companyId = String(formData.get("companyId"));
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) backTo(companyId, "Company not found.");

  if (!(await isOrgManager(company.organizationId, user.id))) {
    backTo(companyId, "Only ADMIN or OWNER can manage counterparties.");
    return;
  }

  const parsed = createCounterpartySchema.safeParse({
    legalName: formData.get("legalName"),
    type: formData.get("type"),
  });
  if (!parsed.success) {
    backTo(companyId, parsed.error.issues[0]?.message ?? "Invalid counterparty.");
    return;
  }

  await createCounterparty(company.organizationId, parsed.data, {
    actorUserId: user.id,
    correlationId: crypto.randomUUID(),
  });

  revalidatePath("/dashboard");
  backTo(companyId);
}

export async function addBeneficiaryAction(formData: FormData) {
  const companyId = String(formData.get("companyId"));
  const counterpartyId = String(formData.get("counterpartyId"));
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const counterparty = await prisma.counterparty.findUnique({ where: { id: counterpartyId } });
  if (!counterparty) {
    backTo(companyId, "Counterparty not found.");
    return;
  }

  if (!(await isOrgManager(counterparty.organizationId, user.id))) {
    backTo(companyId, "Only ADMIN or OWNER can manage beneficiaries.");
    return;
  }

  const parsed = createBeneficiarySchema.safeParse({
    paymentMethod: formData.get("paymentMethod"),
    payoutDetails: formData.get("payoutDetails"),
  });
  if (!parsed.success) {
    backTo(companyId, parsed.error.issues[0]?.message ?? "Invalid beneficiary.");
    return;
  }

  await createBeneficiary(counterparty, parsed.data, {
    actorUserId: user.id,
    correlationId: crypto.randomUUID(),
  });

  revalidatePath("/dashboard");
  backTo(companyId);
}

export async function requestPaymentAction(formData: FormData) {
  const companyId = String(formData.get("companyId"));
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) backTo(companyId, "Company not found.");

  if (!(await canRequestPayment(companyId, company.organizationId, user.id))) {
    backTo(companyId, "Only TREASURY_MANAGER, ADMIN or OWNER can request a payment.");
    return;
  }

  const bankAccountId = String(formData.get("bankAccountId"));
  const beneficiaryId = String(formData.get("beneficiaryId"));

  const parsed = createPaymentSchema.safeParse({
    companyId,
    bankAccountId,
    beneficiaryId,
    paymentType: formData.get("paymentType"),
    paymentMethod: formData.get("paymentMethod"),
    amount: formData.get("amount"),
    currency: formData.get("currency"),
  });
  if (!parsed.success) {
    backTo(companyId, parsed.error.issues[0]?.message ?? "Invalid payment.");
    return;
  }

  const bankAccount = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
  const beneficiary = await prisma.beneficiary.findUnique({
    where: { id: beneficiaryId },
    include: { counterparty: true },
  });
  if (!bankAccount || !beneficiary) {
    backTo(companyId, "Bank account or beneficiary not found.");
    return;
  }

  try {
    await createPayment(company, bankAccount, beneficiary, {
      ...parsed.data,
      idempotencyKey: crypto.randomUUID(),
      actorUserId: user.id,
      correlationId: crypto.randomUUID(),
    });
  } catch (err) {
    backTo(companyId, err instanceof PaymentValidationError ? err.message : "Could not request the payment.");
    return;
  }

  revalidatePath("/dashboard");
  backTo(companyId);
}

async function requirePaymentAndCompany(companyId: string, paymentId: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) backTo(companyId, "Payment not found.");
  const company = await prisma.company.findUnique({ where: { id: payment.companyId } });
  if (!company) backTo(companyId, "Payment not found.");
  return { payment, company };
}

export async function approvePaymentAction(formData: FormData) {
  const companyId = String(formData.get("companyId"));
  const paymentId = String(formData.get("paymentId"));
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const { company } = await requirePaymentAndCompany(companyId, paymentId);
  if (!(await canApprovePayment(company.id, company.organizationId, user.id))) {
    backTo(companyId, "Only an APPROVER, ADMIN or OWNER can approve a payment.");
    return;
  }

  await approvePayment(paymentId, { actorUserId: user.id, correlationId: crypto.randomUUID() });

  revalidatePath("/dashboard");
  backTo(companyId);
}

export async function rejectPaymentAction(formData: FormData) {
  const companyId = String(formData.get("companyId"));
  const paymentId = String(formData.get("paymentId"));
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const { company } = await requirePaymentAndCompany(companyId, paymentId);
  if (!(await canApprovePayment(company.id, company.organizationId, user.id))) {
    backTo(companyId, "Only an APPROVER, ADMIN or OWNER can reject a payment.");
    return;
  }

  await rejectPayment(
    paymentId,
    { actorUserId: user.id, correlationId: crypto.randomUUID() },
    (formData.get("reason") as string) || undefined
  );

  revalidatePath("/dashboard");
  backTo(companyId);
}

export async function executePaymentAction(formData: FormData) {
  const companyId = String(formData.get("companyId"));
  const paymentId = String(formData.get("paymentId"));
  const { user } = await requireTreasuryManager(companyId);

  try {
    await executePayment(paymentId, { actorUserId: user.id, correlationId: crypto.randomUUID() });
  } catch (err) {
    backTo(companyId, err instanceof Error ? err.message : "Could not execute the payment.");
    return;
  }

  revalidatePath("/dashboard");
  backTo(companyId);
}

export async function cancelPaymentAction(formData: FormData) {
  const companyId = String(formData.get("companyId"));
  const paymentId = String(formData.get("paymentId"));
  const { user } = await requireTreasuryManager(companyId);

  try {
    await cancelPayment(paymentId, { actorUserId: user.id, correlationId: crypto.randomUUID() });
  } catch (err) {
    backTo(companyId, err instanceof Error ? err.message : "Could not cancel the payment.");
    return;
  }

  revalidatePath("/dashboard");
  backTo(companyId);
}

// Demo/dev-only: mock providers have no real async delivery, so a
// PENDING payment (PROCESSING here) needs a manual nudge to exercise
// the webhook framework end-to-end -- see lib/providers/simulate.ts.
export async function simulatePaymentWebhookAction(formData: FormData) {
  const companyId = String(formData.get("companyId"));
  const paymentId = String(formData.get("paymentId"));
  const outcome = String(formData.get("outcome")) === "FAILED" ? "FAILED" : "SUCCEEDED";
  await requireTreasuryManager(companyId);

  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment?.providerId || !payment.providerPaymentId) {
    backTo(companyId, "This payment has no pending provider callback to simulate.");
    return;
  }

  await simulateProviderWebhook(
    payment.providerId,
    payment.providerPaymentId,
    outcome,
    outcome === "FAILED" ? { failureCode: "MOCK_SIMULATED", failureReason: "Simulated from the dashboard." } : undefined
  );

  revalidatePath("/dashboard");
  backTo(companyId);
}
