import crypto from "node:crypto";
import { prisma } from "./prisma";
import type { Prisma } from "../generated/prisma/client";

// audit_events is append-only (docs/01-DATABASE-SPEC.md, enforced in the
// DB via a REVOKE on UPDATE/DELETE) — this is the only way rows get
// written, on purpose.
export async function logAudit(params: {
  organizationId: string;
  actorUserId?: string | null;
  action: string;
  objectType: string;
  objectId?: string | null;
  correlationId?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  await prisma.auditEvent.create({
    data: {
      organizationId: params.organizationId,
      actorUserId: params.actorUserId ?? null,
      action: params.action,
      objectType: params.objectType,
      objectId: params.objectId ?? null,
      correlationId: params.correlationId ?? crypto.randomUUID(),
      metadata: params.metadata,
    },
  });
}
