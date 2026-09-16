import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: vi.fn() },
}));

import { prisma } from "@/lib/prisma";
import { GET } from "@/app/api/ready/route";

describe("GET /api/ready", () => {
  it("returns 200 ready when the database check succeeds", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ "?column?": 1 }]);

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: "ready",
      checks: { application: "ok", database: "ok" },
    });
  });

  it("returns 503 without leaking the underlying error when the database check fails", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error("connection refused"));

    const res = await GET();

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({
      status: "not_ready",
      checks: { application: "ok", database: "error" },
    });
    expect(JSON.stringify(body)).not.toContain("connection refused");
  });
});
