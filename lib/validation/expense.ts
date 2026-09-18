import * as z from "zod";
import { decimalAmount } from "./money";

const RECURRENCE = ["ONE_OFF", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const;

export const createExpenseCategorySchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  parentId: z.uuid().optional(),
});

export const createExpenseSchema = z.object({
  companyId: z.uuid(),
  categoryId: z.uuid(),
  counterpartyId: z.uuid().optional(),
  contractId: z.uuid().optional(),
  amount: decimalAmount,
  currency: z.string().length(3),
  recurrence: z.enum(RECURRENCE).default("ONE_OFF"),
  dueDate: z.iso.date(),
  budgetAmount: decimalAmount.optional(),
});

// Editable only while PENDING_APPROVAL (lib/expenses/expenses.ts) --
// status itself changes only via POST /expenses/:id/approve.
export const updateExpenseSchema = z.object({
  categoryId: z.uuid().optional(),
  counterpartyId: z.uuid().optional(),
  contractId: z.uuid().optional(),
  amount: decimalAmount.optional(),
  currency: z.string().length(3).optional(),
  recurrence: z.enum(RECURRENCE).optional(),
  dueDate: z.iso.date().optional(),
  budgetAmount: decimalAmount.optional(),
});
