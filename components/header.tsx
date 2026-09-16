"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function Header({ userEmail }: { userEmail: string | null }) {
  const router = useRouter();

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-3">
      <span className="font-semibold">Treasury Platform</span>
      {userEmail ? (
        <div className="flex items-center gap-4 text-sm">
          <span className="text-neutral-600">{userEmail}</span>
          <button
            onClick={handleSignOut}
            className="rounded border border-neutral-300 px-3 py-1 hover:bg-neutral-100"
          >
            Sign out
          </button>
        </div>
      ) : null}
    </header>
  );
}
