import "dotenv/config";
import { prisma } from "../lib/prisma";
import { syncLinkFully } from "../lib/providers/piraeus/service";

// docs/13-PIRAEUS-PROVIDER.md "Synchronization": a separate long-running
// process, not a polling loop inside a Next.js request handler -- same
// repository/domain modules/database as the web app, just a different
// entry point (infrastructure/production/docker-compose.yml `sync-
// worker` service, built from the same image, `builder` stage, same as
// `migrate`). Still a modular monolith: no separate API, no separate
// deployment artifact, no separate version.
//
// Safe restart: each tick re-reads ACTIVE links from the DB and
// syncTransactions() is itself idempotent (cursor + dedup by
// fingerprint), so a crash/restart mid-cycle just repeats safely.

const POLL_INTERVAL_MS = Number(process.env.PIRAEUS_SYNC_POLL_INTERVAL_SECONDS ?? "900") * 1000;

async function tick() {
  const links = await prisma.providerAccountLink.findMany({ where: { status: "ACTIVE" } });
  for (const link of links) {
    try {
      const result = await syncLinkFully(link.id, { manual: false });
      console.log(JSON.stringify({ scope: "piraeus_sync_worker", linkId: link.id, ...result }));
    } catch (err) {
      // Isolated per link -- one failing connection must not stop the
      // rest of the org's/other orgs' accounts from syncing.
      console.error(
        JSON.stringify({ scope: "piraeus_sync_worker", linkId: link.id, error: err instanceof Error ? err.message : String(err) })
      );
    }
  }
}

async function main() {
  console.log(JSON.stringify({ scope: "piraeus_sync_worker", event: "started", pollIntervalMs: POLL_INTERVAL_MS }));
  for (;;) {
    await tick().catch((err) => {
      console.error(JSON.stringify({ scope: "piraeus_sync_worker", event: "tick_failed", error: err instanceof Error ? err.message : String(err) }));
    });
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
