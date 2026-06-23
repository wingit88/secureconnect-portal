import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "School Network Portal",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}