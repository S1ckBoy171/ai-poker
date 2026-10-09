import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { recentHands } from "@/lib/db";
import { Card } from "../ui";

export const metadata: Metadata = { title: "Hand history · Agent Hold'em" };

export default function HistoryPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-wide text-white sm:text-5xl">HAND HISTORY</h1>
          <p className="mt-1 text-sm text-cream/70">The last 200 hands, newest first. Your game keeps running in the table tab.</p>
        </div>
        <Link href="/play" className="btn-gold">
          TABLE
        </Link>
      </header>
      <Suspense fallback={<p className="text-cream/70">Loading hands…</p>}>
        <Hands />
      </Suspense>
    </main>
  );
}

async function Hands() {
  await connection(); // read the DB on every request
  const rows = await recentHands();
  if (!rows.length) return <p className="text-cream/70">No hands played yet. Finished hands show up here.</p>;
  const games = Map.groupBy(rows, (r) => r.gameId);
  const when = (d: Date) => d.toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });

  return [...games.values()].map((hands) => (
    <section key={hands[0].gameId} className="mb-10">
      <h2 className="mb-3 font-display text-lg tracking-wider text-gold">GAME · {when(hands.at(-1)!.at).toUpperCase()}</h2>
      <div className="space-y-2">
        {hands.map(({ hand, at }) => (
          <details key={hand.number} className="anim-rise group rounded-2xl bg-black/35 ring-1 ring-gold/20 open:bg-black/45">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <span className="w-24 font-display text-lg">Hand #{hand.number}</span>
              <span className="flex gap-1">
                {hand.board.length ? hand.board.map((c) => <Card key={c} c={c} size="xs" win={hand.winners.some((w) => w.cards.includes(c))} />) : <span className="text-sm text-cream/50">no flop</span>}
              </span>
              <span className="flex-1 text-sm">
                {hand.winners.map((w) => `${w.name} won ${w.amount.toLocaleString()}${w.hand && ` · ${w.hand}`}`).join(", ")}
              </span>
              <span className="text-xs text-cream/50">{at.toLocaleTimeString("en", { timeStyle: "short" })}</span>
            </summary>
            <div className="grid gap-5 border-t border-gold/15 px-4 py-4 md:grid-cols-[1fr_1.3fr]">
              <table className="h-fit w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-cream/50">
                    <th className="pb-2 font-normal">Player</th>
                    <th className="pb-2 font-normal">Cards</th>
                    <th className="pb-2 text-right font-normal">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {hand.players.map((p) => (
                    <tr key={p.name} className="border-t border-white/5">
                      <td className="py-1.5">{p.name}</td>
                      <td className="py-1.5">
                        <span className="flex gap-1">{p.cards.length ? p.cards.map((c) => <Card key={c} c={c} size="xs" />) : <span className="text-cream/40">-</span>}</span>
                      </td>
                      <td className={`py-1.5 text-right font-display ${p.delta > 0 ? "text-emerald-300" : p.delta < 0 ? "text-red-300" : "text-cream/60"}`}>
                        {p.delta > 0 ? "+" : ""}
                        {p.delta.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ol className="space-y-0.5 text-sm text-cream/85">
                {hand.history.map((line, k) => (
                  <li key={k}>{line}</li>
                ))}
              </ol>
            </div>
          </details>
        ))}
      </div>
    </section>
  ));
}
