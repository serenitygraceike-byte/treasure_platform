import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    membership: { findUnique: vi.fn() },
    companyMembership: { findUnique: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { canAccessCompany, isOrgManager } from "@/lib/rbac";

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
