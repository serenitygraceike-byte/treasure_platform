import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    membership: { findUnique: vi.fn() },
    companyMembership: { findUnique: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  canAccessCompany,
  canApproveExpense,
  canApproveIntercompany,
  canApprovePayment,
  canManageExpenses,
  canManageTreasury,
  canRequestPayment,
  isOrgManager,
} from "@/lib/rbac";

describe("isOrgManager", () => {
  it("is true for OWNER and ADMIN", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce({ role: "OWNER" } as never);
    expect(await isOrgManager("org1", "user1")).toBe(true);
  });

  it("is false for VIEWER", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce({ role: "VIEWER" } as never);
    expect(await isOrgManager("org1", "user1")).toBe(false);
  });

  it("is false with no membership at all", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce(null);
    expect(await isOrgManager("org1", "user1")).toBe(false);
  });
});

describe("canAccessCompany", () => {
  it("org managers can access any company without a CompanyMembership row", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce({ role: "ADMIN" } as never);
    expect(await canAccessCompany("company1", "org1", "user1")).toBe(true);
    expect(prisma.companyMembership.findUnique).not.toHaveBeenCalled();
  });

  it("non-managers need an explicit CompanyMembership", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce({ role: "VIEWER" } as never);
    vi.mocked(prisma.companyMembership.findUnique).mockResolvedValueOnce({ role: "VIEWER" } as never);
    expect(await canAccessCompany("company1", "org1", "user1")).toBe(true);
  });

  it("denies a non-manager with no CompanyMembership", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce({ role: "VIEWER" } as never);
    vi.mocked(prisma.companyMembership.findUnique).mockResolvedValueOnce(null);
    expect(await canAccessCompany("company1", "org1", "user1")).toBe(false);
  });
});

describe("canManageTreasury", () => {
  it("is true for an org-level TREASURY_MANAGER without a CompanyMembership row", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce({ role: "TREASURY_MANAGER" } as never);
    expect(await canManageTreasury("company1", "org1", "user1")).toBe(true);
    expect(prisma.companyMembership.findUnique).not.toHaveBeenCalled();
  });

  it("is true for a company-level TREASURY_MANAGER even without org role", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.companyMembership.findUnique).mockResolvedValueOnce({ role: "TREASURY_MANAGER" } as never);
    expect(await canManageTreasury("company1", "org1", "user1")).toBe(true);
  });

  it("is false for a plain VIEWER (org or company level)", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce({ role: "VIEWER" } as never);
    vi.mocked(prisma.companyMembership.findUnique).mockResolvedValueOnce({ role: "VIEWER" } as never);
    expect(await canManageTreasury("company1", "org1", "user1")).toBe(false);
  });

  it("is false for an APPROVER (not a treasury-manager role in Phase 3)", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce({ role: "APPROVER" } as never);
    vi.mocked(prisma.companyMembership.findUnique).mockResolvedValueOnce(null);
    expect(await canManageTreasury("company1", "org1", "user1")).toBe(false);
  });
});

describe("canApproveIntercompany", () => {
  it("is true for an org-level APPROVER", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce({ role: "APPROVER" } as never);
    expect(await canApproveIntercompany("org1", "user1")).toBe(true);
    expect(prisma.companyMembership.findUnique).not.toHaveBeenCalled();
  });

  it("is true for OWNER/ADMIN", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce({ role: "OWNER" } as never);
    expect(await canApproveIntercompany("org1", "user1")).toBe(true);
  });

  it("is false with no org membership at all, even if a company-level APPROVER exists", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce(null);
    expect(await canApproveIntercompany("org1", "user1")).toBe(false);
    // deliberately org-level only -- never falls back to companyMembership
    expect(prisma.companyMembership.findUnique).not.toHaveBeenCalled();
  });

  it("is false for a plain org-level TREASURY_MANAGER", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce({ role: "TREASURY_MANAGER" } as never);
    expect(await canApproveIntercompany("org1", "user1")).toBe(false);
  });
});

describe("canManageExpenses", () => {
  it("is true for an org-level ACCOUNTANT without a CompanyMembership row", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce({ role: "ACCOUNTANT" } as never);
    expect(await canManageExpenses("company1", "org1", "user1")).toBe(true);
    expect(prisma.companyMembership.findUnique).not.toHaveBeenCalled();
  });

  it("is true for a company-level ACCOUNTANT even without org role", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.companyMembership.findUnique).mockResolvedValueOnce({ role: "ACCOUNTANT" } as never);
    expect(await canManageExpenses("company1", "org1", "user1")).toBe(true);
  });

  it("is false for a plain VIEWER (org or company level)", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce({ role: "VIEWER" } as never);
    vi.mocked(prisma.companyMembership.findUnique).mockResolvedValueOnce({ role: "VIEWER" } as never);
    expect(await canManageExpenses("company1", "org1", "user1")).toBe(false);
  });

  it("is false for a TREASURY_MANAGER (not an expense-manager role)", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce({ role: "TREASURY_MANAGER" } as never);
    vi.mocked(prisma.companyMembership.findUnique).mockResolvedValueOnce(null);
    expect(await canManageExpenses("company1", "org1", "user1")).toBe(false);
  });
});

describe("canApproveExpense", () => {
  it("is true for an org-level APPROVER without a CompanyMembership row", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce({ role: "APPROVER" } as never);
    expect(await canApproveExpense("company1", "org1", "user1")).toBe(true);
    expect(prisma.companyMembership.findUnique).not.toHaveBeenCalled();
  });

  it("is true for a company-level APPROVER even without org role", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.companyMembership.findUnique).mockResolvedValueOnce({ role: "APPROVER" } as never);
    expect(await canApproveExpense("company1", "org1", "user1")).toBe(true);
  });

  it("is false for a plain ACCOUNTANT (creator, not approver)", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce({ role: "ACCOUNTANT" } as never);
    vi.mocked(prisma.companyMembership.findUnique).mockResolvedValueOnce(null);
    expect(await canApproveExpense("company1", "org1", "user1")).toBe(false);
  });
});

describe("canRequestPayment", () => {
  it("is true for an org-level TREASURY_MANAGER without a CompanyMembership row", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce({ role: "TREASURY_MANAGER" } as never);
    expect(await canRequestPayment("company1", "org1", "user1")).toBe(true);
    expect(prisma.companyMembership.findUnique).not.toHaveBeenCalled();
  });

  it("is true for a company-level TREASURY_MANAGER even without org role", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.companyMembership.findUnique).mockResolvedValueOnce({ role: "TREASURY_MANAGER" } as never);
    expect(await canRequestPayment("company1", "org1", "user1")).toBe(true);
  });

  it("is false for a plain ACCOUNTANT with no treasury role", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce({ role: "ACCOUNTANT" } as never);
    vi.mocked(prisma.companyMembership.findUnique).mockResolvedValueOnce(null);
    expect(await canRequestPayment("company1", "org1", "user1")).toBe(false);
  });
});

describe("canApprovePayment", () => {
  it("is true for an org-level APPROVER without a CompanyMembership row", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce({ role: "APPROVER" } as never);
    expect(await canApprovePayment("company1", "org1", "user1")).toBe(true);
    expect(prisma.companyMembership.findUnique).not.toHaveBeenCalled();
  });

  it("is true for a company-level APPROVER even without org role", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.companyMembership.findUnique).mockResolvedValueOnce({ role: "APPROVER" } as never);
    expect(await canApprovePayment("company1", "org1", "user1")).toBe(true);
  });

  it("is false for a plain TREASURY_MANAGER (requester, not approver)", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce({ role: "TREASURY_MANAGER" } as never);
    vi.mocked(prisma.companyMembership.findUnique).mockResolvedValueOnce(null);
    expect(await canApprovePayment("company1", "org1", "user1")).toBe(false);
  });
});
