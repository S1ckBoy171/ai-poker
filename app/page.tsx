"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { AgentBuilder } from "./agent-builder";
import { MatchSetup } from "./match-setup";
import { BrandName, SpadeBadge } from "./ui";

type Tab = "build" | "match" | "friends";

const TABS: [Tab, string][] = [
  ["build", "Build Your Agent"],
  ["match", "Start Match with Bots"],
  ["friends", "Play with Friends"],
];
const NAV_LINK = "rounded-full px-3 py-1.5 text-cream/80 ring-1 ring-gold/30 transition-colors hover:bg-black/30 hover:text-cream";

export default function Home() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("match");
  const [friend, setFriend] = useState({ name: "", stack: 1000, bb: 20, code: "" });
  const [friendError, setFriendError] = useState("");
  const { data: session } = authClient.useSession();

  const signOut = async () => {
    await authClient.signOut();
    router.push("/login");
  };

  const createTable = async (e: FormEvent) => {
    e.preventDefault();
    setFriendError("");
    const res = await fetch("/api/tables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...friend, name: friend.name || session?.user.name }),
    });
    const reply = await res.json().catch(() => ({}));
    if (!res.ok) {
      return setFriendError(reply.error ?? "Could not create the table.");
    }
    try {
      localStorage.setItem(`agent-holdem-table:${reply.code}`, reply.token); // your seat's secret, kept in this browser (the table page reads it)
    } catch {
      // storage blocked: you can still watch the table, but not play from your seat
    }
    router.push(`/t/${reply.code}`);
  };

  const joinTable = (e: FormEvent) => {
    e.preventDefault();
    const code = friend.code.toLowerCase().match(/[0-9a-f]{8}/)?.[0]; // accepts the code or the whole invite link
    if (code) {
      router.push(`/t/${code}`);
    } else {
      setFriendError("A table code is 8 letters and digits, like 3f9a1c0b.");
    }
  };

  /** Left and right arrows move between the tabs, wrapping around. */
  const tabKeys = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") {
      return;
    }
    const step = e.key === "ArrowRight" ? 1 : -1;
    const index = TABS.findIndex(([id]) => id === tab);
    const [next] = TABS[(index + step + TABS.length) % TABS.length];
    setTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  };

  return (
    <main className="min-h-dvh px-4 pb-16">
      <header className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-y-3 py-4">
        <div className="flex items-center gap-2 font-display text-xl tracking-wide sm:text-2xl">
          <SpadeBadge />
          <BrandName />
        </div>
        {/* below xl the header reaches the corner, so leave room for the music button (app/music-button.tsx) */}
        <nav className="mr-12 flex items-center gap-2 text-sm sm:mr-14 xl:mr-0">
          <Link href="/play" className={NAV_LINK}>
            Table
          </Link>
          <Link href="/history" className={NAV_LINK}>
            History
          </Link>
          {session && (
            <span className="ml-2 hidden max-w-40 truncate text-cream/70 sm:inline" title={session.user.email}>
              {session.user.name}
            </span>
          )}
          <button onClick={signOut} className={NAV_LINK}>
            Sign out
          </button>
        </nav>
      </header>

      <section className="mx-auto max-w-5xl pt-6 text-center sm:pt-12">
        <h1 className="font-display text-5xl font-bold tracking-wide text-white sm:text-7xl">PLAY POKER WITH AI</h1>
        <p className="mx-auto mt-3 max-w-xl text-cream/75">No-limit Texas Hold&apos;em against models from Anthropic, OpenAI and OpenRouter.</p>
        <div role="tablist" aria-label="Choose a mode" className="seg mx-auto mt-8 w-fit" onKeyDown={tabKeys}>
          {TABS.map(([id, text]) => (
            <button
              key={id}
              id={`tab-${id}`}
              role="tab"
              aria-selected={tab === id}
              aria-controls={`panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
            >
              {text}
            </button>
          ))}
        </div>
      </section>

      <section key={tab} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="anim-rise panel mx-auto mt-6 max-w-5xl p-5 sm:p-9">
        {tab === "friends" && (
          <div className="grid gap-8 md:grid-cols-2">
            <form onSubmit={createTable}>
              <h2 className="font-display text-2xl tracking-wide text-white">CREATE A TABLE</h2>
              <p className="mt-1 text-sm text-cream/70">You host it and deal the first hand. Humans only, up to 9 players.</p>
              <label className="mt-4 block text-sm">
                Your name
                <input
                  maxLength={16}
                  placeholder={session?.user.name.slice(0, 16)}
                  className="field mt-1 w-full text-lg"
                  value={friend.name}
                  onChange={(e) => setFriend({ ...friend, name: e.target.value })}
                />
              </label>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="text-sm">
                  Starting chips
                  <input
                    type="number"
                    min={100}
                    className="field mt-1 w-full"
                    value={friend.stack || ""}
                    onChange={(e) => setFriend({ ...friend, stack: Number(e.target.value) })}
                  />
                </label>
                <label className="text-sm">
                  Big blind
                  <input
                    type="number"
                    min={2}
                    className="field mt-1 w-full"
                    value={friend.bb || ""}
                    onChange={(e) => setFriend({ ...friend, bb: Number(e.target.value) })}
                  />
                </label>
              </div>
              <button className="btn-gold mt-5">CREATE TABLE</button>
            </form>
            <form onSubmit={joinTable} className="md:border-l md:border-gold/20 md:pl-8">
              <h2 className="font-display text-2xl tracking-wide text-white">JOIN A TABLE</h2>
              <p className="mt-1 text-sm text-cream/70">Enter the code a friend sent you, or paste their invite link.</p>
              <label className="mt-4 block text-sm">
                Table code
                <input
                  required
                  className="field mt-1 w-full font-display text-xl tracking-[0.2em]"
                  placeholder="3f9a1c0b"
                  value={friend.code}
                  onChange={(e) => setFriend({ ...friend, code: e.target.value })}
                />
              </label>
              <button className="btn-gold mt-5">JOIN TABLE</button>
            </form>
            {friendError && (
              <p role="alert" className="text-red-200 md:col-span-2">
                {friendError}
              </p>
            )}
          </div>
        )}

        {tab === "build" && <AgentBuilder />}

        {tab === "match" && <MatchSetup />}
      </section>
    </main>
  );
}
