import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/header";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Treasury Platform",
  description: "Multi-Entity Treasury Platform",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();

  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-neutral-900">
        <Header userEmail={user?.email ?? null} />
        {children}
      </body>
    </html>
  );
}
