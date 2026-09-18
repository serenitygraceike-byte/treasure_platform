import * as z from "zod";
import { decimalAmount } from "./money";

export const upsertBudgetSchema = z.object({
  categoryId: z.uuid(),
  periodYear: z.coerce.number().int().min(2000).max(2100),
  periodMonth: z.coerce.number().int().min(1).max(12),
  amount: decimalAmount,
  currency: z.string().length(3),
});

export const budgetPeriodQuerySchema = z.object({
  periodYear: z.coerce.number().int().min(2000).max(2100),
  periodMonth: z.coerce.number().int().min(1).max(12),
});
