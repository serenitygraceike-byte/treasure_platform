import { NextResponse } from "next/server";
import { completeConnection } from "@/lib/providers/piraeus/service";
import { PiraeusOAuthStateError } from "@/lib/providers/piraeus/errors";

// docs/13-PIRAEUS-PROVIDER.md OAuth section. This is the browser
// redirect target Piraeus calls -- it carries no app Authorization
// header, only `code`/`state`/optionally `error` as query params. The
// state itself (validated inside completeConnection) is what proves
// this callback belongs to a legitimate, still-fresh, not-yet-consumed
// authorization request that was issued to a specific organization/
// user -- nothing else about the request is trusted.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");

  const dashboardUrl = new URL("/dashboard", url.origin);

  if (error || !state || !code) {
    dashboardUrl.searchParams.set("error", "Piraeus connection failed or was cancelled.");
    return NextResponse.redirect(dashboardUrl);
  }

  try {
    await completeConnection(state, code);
    dashboardUrl.searchParams.set("piraeusConnected", "1");
  } catch (err) {
    dashboardUrl.searchParams.set(
      "error",
      err instanceof PiraeusOAuthStateError ? "Piraeus connection link expired or was already used." : "Piraeus connection failed."
    );
  }
  return NextResponse.redirect(dashboardUrl);
}
