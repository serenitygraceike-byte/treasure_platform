import * as z from "zod";
import { decimalAmount } from "./money";

export const createReservationSchema = z.object({
  amount: decimalAmount,
});

export const createTransferSchema = z.object({
  destinationAccountId: z.uuid(),
  amount: decimalAmount,
});
