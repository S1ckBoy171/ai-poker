import type { Metadata } from "next";
import { Lato, Oswald } from "next/font/google";
import "./globals.css";

const lato = Lato({ variable: "--font-lato", weight: ["400", "700", "900"], subsets: ["latin"] });
const oswald = Oswald({ variable: "--font-oswald", weight: ["500", "700"], subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Agent Hold'em",
  description: "No-limit Texas Hold'em against AI agents from Anthropic, OpenAI and OpenRouter.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${lato.variable} ${oswald.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
