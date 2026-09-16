import * as z from "zod";
import { decimalAmount } from "./money";

export const createIntercompanyTransferSchema = z.object({
  bankAccountId: z.uuid(),
  toCompanyId: z.uuid(),
  destinationAccountId: z.uuid(),
  amount: decimalAmount,
  purpose: z.string().max(500).optional(),
  dueAt: z.iso.datetime().optional(),
});

export const rejectIntercompanyTransferSchema = z.object({
  reason: z.string().max(500).optional(),
});
