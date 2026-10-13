import type { Metadata } from "next";
import Link from "next/link";
import { MyKeys } from "./my-keys";

export const metadata: Metadata = { title: "My keys · Agent Hold'em" };

export default function KeysPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-4xl font-bold tracking-wide text-white sm:text-5xl">MY KEYS</h1>
          <p className="mt-1 text-sm text-cream/70">
            The API keys your bots and agents play with. They are saved in your account and never sent back to the browser.
          </p>
        </div>
        <Link href="/" className="btn-gold">
          HOME
        </Link>
      </header>
      <MyKeys />
    </main>
  );
}
