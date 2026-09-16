import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Treasury Platform",
  description: "Multi-Entity Treasury Platform",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
