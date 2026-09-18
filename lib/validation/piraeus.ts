import * as z from "zod";

export const connectPiraeusSchema = z.object({
  organizationId: z.uuid(),
  companyId: z.uuid().optional(),
});

export const linkProviderAccountSchema = z.object({
  connectionId: z.uuid(),
  externalAccountId: z.string().min(1).max(200),
});
