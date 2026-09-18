import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

export class ExpenseCategoryValidationError extends Error {}

export async function createExpenseCategory(
  organizationId: string,
  input: { code: string; name: string; parentId?: string },
  ctx: { actorUserId: string; correlationId?: string }
) {
  if (input.parentId) {
    const parent = await prisma.expenseCategory.findUnique({ where: { id: input.parentId } });
    if (!parent || parent.organizationId !== organizationId) {
      throw new ExpenseCategoryValidationError("parentId must be a category in the same organization.");
    }
  }

  const category = await prisma.expenseCategory.create({
    data: {
      organizationId,
      code: input.code,
      name: input.name,
      parentId: input.parentId,
    },
  });

  await logAudit({
    organizationId,
    actorUserId: ctx.actorUserId,
    action: "expense_category.create",
    objectType: "expense_category",
    objectId: category.id,
    correlationId: ctx.correlationId,
  });

  return category;
}

export async function listExpenseCategories(organizationId: string) {
  return prisma.expenseCategory.findMany({
    where: { organizationId },
    orderBy: { code: "asc" },
  });
}
