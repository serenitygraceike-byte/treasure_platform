import "dotenv/config";
import { auth } from "../lib/auth";
import { prisma } from "../lib/prisma";

// Dev/seed-only credentials — never used against a real deployment.
// docs/09-CLAUDE-HANDOFF.md: "Do not create real bank credentials."
const SEED_PASSWORD = "SeedDev1234!";

async function ensureUser(name: string, email: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;

  const result = await auth.api.signUpEmail({
    body: { name, email, password: SEED_PASSWORD },
  });
  return prisma.user.findUniqueOrThrow({ where: { id: result.user.id } });
}

async function main() {
  const SEED_ORG_ID = "11111111-1111-4111-8111-000000000001";
  const org = await prisma.organization.upsert({
    where: { id: SEED_ORG_ID },
    update: {},
    create: {
      id: SEED_ORG_ID,
      name: "Acme Group",
      baseCurrency: "EUR",
    },
  });

  const companies = [
    { legalName: "Acme Hellas SA", countryCode: "GR", baseCurrency: "EUR" },
    { legalName: "Acme Digital Hellas", countryCode: "GR", baseCurrency: "EUR" },
    { legalName: "Acme Beograd DOO", countryCode: "RS", baseCurrency: "RSD" },
    { legalName: "Acme Balkans DOO", countryCode: "RS", baseCurrency: "RSD" },
  ];

  const createdCompanies = [];
  for (const c of companies) {
    const company = await prisma.company.upsert({
      where: { organizationId_legalName: { organizationId: org.id, legalName: c.legalName } },
      update: {},
      create: { organizationId: org.id, ...c },
    });
    createdCompanies.push(company);
  }

  const owner = await ensureUser("Seed Owner", "owner@example.local");
  const admin = await ensureUser("Seed Admin", "admin@example.local");
  const accountant = await ensureUser("Seed Accountant", "accountant@example.local");
  const viewer = await ensureUser("Seed Viewer", "viewer@example.local");

  const orgRoles: [string, "OWNER" | "ADMIN" | "ACCOUNTANT" | "VIEWER"][] = [
    [owner.id, "OWNER"],
    [admin.id, "ADMIN"],
    [accountant.id, "ACCOUNTANT"],
    [viewer.id, "VIEWER"],
  ];
  for (const [userId, role] of orgRoles) {
    await prisma.membership.upsert({
      where: { organizationId_userId: { organizationId: org.id, userId } },
      update: { role },
      create: { organizationId: org.id, userId, role },
    });
  }

  // Company-level access: accountant sees the two Greek entities, viewer
  // sees just one — demonstrates that org membership alone isn't enough.
  const companyAccess: [string, string, "ACCOUNTANT" | "VIEWER"][] = [
    [createdCompanies[0]!.id, accountant.id, "ACCOUNTANT"],
    [createdCompanies[1]!.id, accountant.id, "ACCOUNTANT"],
    [createdCompanies[0]!.id, viewer.id, "VIEWER"],
  ];
  for (const [companyId, userId, role] of companyAccess) {
    await prisma.companyMembership.upsert({
      where: { companyId_userId: { companyId, userId } },
      update: { role },
      create: { companyId, userId, role },
    });
  }

  console.log(`Seeded organization "${org.name}" with ${createdCompanies.length} companies.`);
  console.log("Seed users (password: SeedDev1234!):");
  console.log("  owner@example.local       — OWNER");
  console.log("  admin@example.local       — ADMIN");
  console.log("  accountant@example.local  — ACCOUNTANT (Acme Hellas SA, Acme Digital Hellas)");
  console.log("  viewer@example.local      — VIEWER (Acme Hellas SA)");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
