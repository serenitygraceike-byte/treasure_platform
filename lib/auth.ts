import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { prisma } from "./prisma";

// Phase 0 scope only: email/password auth, per docs/07-SECURITY-AND-AUDIT.md
// ("email/password initially"). Social providers, 2FA and email
// verification are explicitly later work, not silently added here.
export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
  },
});
