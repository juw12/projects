import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Atomize — Turn one blog post into a week of content",
  description:
    "Paste a blog post. Get 5 LinkedIn posts, 8 tweets, 3 newsletters, and a YouTube Short script. Built for founders and marketers who publish once but want to be everywhere.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
