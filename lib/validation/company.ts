import * as z from "zod";

export const createCompanySchema = z.object({
  organizationId: z.uuid(),
  legalName: z.string().min(1).max(200),
  countryCode: z.string().length(2).toUpperCase(),
  registrationNumber: z.string().max(100).optional(),
  taxIdentifier: z.string().max(100).optional(),
  baseCurrency: z.string().length(3).toUpperCase(),
});

export const updateCompanySchema = z.object({
  legalName: z.string().min(1).max(200).optional(),
  countryCode: z.string().length(2).toUpperCase().optional(),
  registrationNumber: z.string().max(100).nullable().optional(),
  taxIdentifier: z.string().max(100).nullable().optional(),
  baseCurrency: z.string().length(3).toUpperCase().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]).optional(),
});
