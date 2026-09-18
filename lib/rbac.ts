import { prisma } from "./prisma";
import type { OrgRole } from "../generated/prisma/client";

// docs/07-SECURITY-AND-AUDIT.md defines the role set but not yet a full
// permission matrix (that grows with later phases). For Phase 1's scope
// (organization/company management), OWNER and ADMIN manage; every other
// role is read-only at the org level and needs an explicit
// CompanyMembership to see a given company.
const ORG_MANAGER_ROLES: OrgRole[] = ["OWNER", "ADMIN"];

export async function getOrgMembership(organizationId: string, userId: string) {
  return prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
}

export async function isOrgManager(organizationId: string, userId: string) {
  const membership = await getOrgMembership(organizationId, userId);
  return !!membership && ORG_MANAGER_ROLES.includes(membership.role);
}

export async function canAccessCompany(
  companyId: string,
  organizationId: string,
  userId: string
) {
  if (await isOrgManager(organizationId, userId)) return true;
  const companyMembership = await prisma.companyMembership.findUnique({
    where: { companyId_userId: { companyId, userId } },
  });
  return !!companyMembership;
}

// docs/05-MVP-ROADMAP.md Phase 3: money-moving actions (bank accounts,
// reservations, transfers) require a treasury role, not just company
// access — read access (canAccessCompany) stays open to VIEWER etc.
const TREASURY_MANAGER_ROLES: OrgRole[] = ["OWNER", "ADMIN", "TREASURY_MANAGER"];

export async function canManageTreasury(
  companyId: string,
  organizationId: string,
  userId: string
) {
  const membership = await getOrgMembership(organizationId, userId);
  if (membership && TREASURY_MANAGER_ROLES.includes(membership.role)) return true;
  const companyMembership = await prisma.companyMembership.findUnique({
    where: { companyId_userId: { companyId, userId } },
  });
  return !!companyMembership && TREASURY_MANAGER_ROLES.includes(companyMembership.role);
}

// docs/05-MVP-ROADMAP.md Phase 4: intercompany approval spans two
// companies, so it's deliberately org-level only, not company-scoped
// like canManageTreasury -- a company-level APPROVER role does not
// count here, since they'd only have visibility into one side of the
// transfer.
const INTERCOMPANY_APPROVER_ROLES: OrgRole[] = ["OWNER", "ADMIN", "APPROVER"];

export async function canApproveIntercompany(organizationId: string, userId: string) {
  const membership = await getOrgMembership(organizationId, userId);
  return !!membership && INTERCOMPANY_APPROVER_ROLES.includes(membership.role);
}

// docs/05-MVP-ROADMAP.md Phase 5: OPEX bookkeeping (categories,
// expenses, budgets) is scoped to one company, so it uses the same
// dual org/company-level check as canManageTreasury -- ACCOUNTANT is
// the natural owner of this workflow (docs/07-SECURITY-AND-AUDIT.md's
// role list), not just a read-only role like it is for treasury.
const EXPENSE_MANAGER_ROLES: OrgRole[] = ["OWNER", "ADMIN", "ACCOUNTANT"];

export async function canManageExpenses(
  companyId: string,
  organizationId: string,
  userId: string
) {
  const membership = await getOrgMembership(organizationId, userId);
  if (membership && EXPENSE_MANAGER_ROLES.includes(membership.role)) return true;
  const companyMembership = await prisma.companyMembership.findUnique({
    where: { companyId_userId: { companyId, userId } },
  });
  return !!companyMembership && EXPENSE_MANAGER_ROLES.includes(companyMembership.role);
}

// Unlike canApproveIntercompany, expense approval never spans two
// companies -- so it stays company-scoped, same dual-level check as
// canManageTreasury, just with the approver-tier role set.
const EXPENSE_APPROVER_ROLES: OrgRole[] = ["OWNER", "ADMIN", "APPROVER"];

export async function canApproveExpense(
  companyId: string,
  organizationId: string,
  userId: string
) {
  const membership = await getOrgMembership(organizationId, userId);
  if (membership && EXPENSE_APPROVER_ROLES.includes(membership.role)) return true;
  const companyMembership = await prisma.companyMembership.findUnique({
    where: { companyId_userId: { companyId, userId } },
  });
  return !!companyMembership && EXPENSE_APPROVER_ROLES.includes(companyMembership.role);
}
