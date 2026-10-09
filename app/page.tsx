"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { PROVIDERS, PROVIDER_IDS, type Config, type Provider } from "@/lib/config";
import { fetchJson } from "@/lib/fetch-json";
import type { ModelOption } from "./api/models/route";
import type { SettingsResponse } from "./api/settings/route";
import type { KeyEdits } from "./settings";
import { BrandName, SpadeBadge } from "./ui";

type Tab = "build" | "match" | "friends";
type Bot = { name: string; model: string };
type Status = { kind: "idle" | "busy" | "ok" | "error"; text: string };

const TABS: [Tab, string][] = [
  ["build", "Build Your Agent"],
  ["match", "Start Match with Bots"],
  ["friends", "Play with Friends"],
];
const PROVIDER_PREFERENCE: Provider[] = ["openrouter", "anthropic", "openai"]; // which saved key to start with
const BOT_SEATS = 8; // seats 2-9; seat 1 is you
const IDLE: Status = { kind: "idle", text: "" };
const STATUS_COLORS: Record<Status["kind"], string> = {
  idle: "text-cream/70",
  busy: "text-cream/70",
  ok: "text-emerald-300",
  error: "text-red-200",
};
const NAV_LINK = "rounded-full px-3 py-1.5 text-cream/80 ring-1 ring-gold/30 transition-colors hover:bg-black/30 hover:text-cream";

/** Guess the provider from the key's prefix. */
function guessProvider(key: string): Provider | null {
  if (key.startsWith("sk-ant-")) {
    return "anthropic";
  }
  if (key.startsWith("sk-or-")) {
    return "openrouter";
  }
  if (key.startsWith("sk-")) {
    return "openai";
  }
  return null;
}

/** A seat name from a model's display name: "Google: Gemini 3.8 Flash" -> "Gemini 3.8 Flash", "Claude Opus 5.5" -> "Opus 5.5". */
const seatName = (model: ModelOption) =>
  model.name
    .replace(/^[^:]+:\s*/, "")
    .replace(/^Claude\s+/, "")
    .slice(0, 18);

/** Several bots on one model would share a name at the table: number the repeats. Seat 0 (you) is left alone. */
function numberRepeats(bots: Bot[]): Bot[] {
  const timesSeen = new Map<string, number>();
  return bots.map((bot, seat) => {
    if (seat === 0) {
      return bot;
    }
    const count = (timesSeen.get(bot.name) ?? 0) + 1;
    timesSeen.set(bot.name, count);
    if (count === 1) {
      return bot;
    }
    return { ...bot, name: `${bot.name.slice(0, 20)} ${count}` };
  });
}

export default function Home() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("match");
  const [cfg, setCfg] = useState<Config | null>(null);
  const [hints, setHints] = useState<Record<string, string>>({});
  const [provider, setProvider] = useState<Provider>("openrouter");
  const [key, setKey] = useState("");
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [status, setStatus] = useState<Status>(IDLE);
  const [seats, setSeats] = useState<5 | 9>(5);
  const [bots, setBots] = useState<Bot[]>([]); // index = seat; seat 0 is you
  const [starting, setStarting] = useState(false);
  const [friend, setFriend] = useState({ name: "", stack: 1000, bb: 20, code: "" });
  const [friendError, setFriendError] = useState("");
  const { data: session } = authClient.useSession();

  useEffect(() => {
    fetchJson<SettingsResponse>("/api/settings")
      .then(({ config, keys }) => {
        const botProvider = config.agents[1].provider;
        setCfg(config);
        setHints(keys);
        setSeats(config.seats);
        setProvider(keys[botProvider] ? botProvider : (PROVIDER_PREFERENCE.find((p) => keys[p]) ?? "openrouter"));
        setBots(config.agents.map((agent) => ({ name: agent.name, model: agent.model })));
      })
      .catch((e) => setStatus({ kind: "error", text: `Could not load your saved settings: ${e.message}` }));
  }, []);

  const signOut = async () => {
    await authClient.signOut();
    router.push("/login");
  };

  const pickProvider = (picked: Provider) => {
    setProvider(picked);
    setModels(null);
    setStatus(IDLE);
  };

  const onKeyInput = (typed: string) => {
    setKey(typed);
    setModels(null); // a different key may see different models
    setStatus(IDLE);
    const guessed = guessProvider(typed.trim());
    if (guessed) {
      setProvider(guessed);
    }
  };

  /** Check the key with the provider and load the models it can use; bots on a model it can't use get one it can. */
  const checkModels = async (e?: FormEvent) => {
    e?.preventDefault();
    setStatus({ kind: "busy", text: `Checking the key with ${PROVIDERS[provider].label}…` });
    try {
      const reply = await fetchJson<{ models: ModelOption[]; total: number }>("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, key }),
      });
      const list = reply.models;
      if (!list.length) {
        throw new Error("This key works, but no chat models came back.");
      }
      const available = (id: string) => list.some((model) => model.id === id);
      const preferredId = PROVIDERS[provider].models.find(available);
      const fallback = list.find((model) => model.id === preferredId) ?? list[0];
      setModels(list);
      setBots((current) => current.map((bot, seat) => (seat === 0 || available(bot.model) ? bot : { name: seatName(fallback), model: fallback.id })));
      const shownNote = reply.total > list.length ? `, showing the newest ${list.length}` : "";
      setStatus({ kind: "ok", text: `Key works: ${reply.total} models available${shownNote}.` });
    } catch (err) {
      setModels(null);
      setStatus({ kind: "error", text: (err as Error).message });
    }
  };

  /** Give one bot seat (or every bot) a model from the checked list. */
  const setModel = (seat: number | "all", id: string) => {
    const model = models?.find((option) => option.id === id);
    if (!model) {
      return;
    }
    const chosen = (i: number) => i > 0 && (seat === "all" || seat === i);
    setBots((current) => current.map((bot, i) => (chosen(i) ? { name: seatName(model), model: model.id } : bot)));
  };

  const start = async () => {
    if (!cfg || !models) {
      return;
    }
    setStarting(true);
    const named = numberRepeats(bots);
    const agents = cfg.agents.map((agent, seat) => (seat === 0 ? agent : { ...agent, provider, model: named[seat].model, name: named[seat].name }));
    const config: Config = { ...cfg, seats, playing: true, agents };
    // One key for every bot: clear per-seat keys so they can't override it.
    const keys: KeyEdits = {};
    for (let seat = 1; seat <= BOT_SEATS; seat++) {
      keys[`seat:${seat}`] = null;
    }
    const typedKey = key.trim();
    if (typedKey) {
      keys[provider] = typedKey;
    }
    const res = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config, keys }) });
    if (res.ok) {
      return router.push("/play");
    }
    setStarting(false);
    const reply = await res.json().catch(() => ({}));
    setStatus({ kind: "error", text: reply.error ?? "Could not save the match settings." });
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

        {tab === "build" && (
          <div className="grid place-items-center py-16">
            <div className="tooltip-wrap">
              <button aria-disabled="true" aria-describedby="build-tip" className="btn-gold cursor-not-allowed opacity-85">
                BUILD YOUR AGENT
              </button>
              <div id="build-tip" role="tooltip" className="tooltip">
                Coming soon
              </div>
            </div>
          </div>
        )}

        {tab === "match" && (
          <>
            <div className="grid gap-8 lg:grid-cols-[1fr_1.15fr]">
              <form onSubmit={checkModels}>
                <h2 className="font-display text-2xl tracking-wide text-white">1 · API KEY</h2>
                <p className="mt-1 text-sm text-cream/70">One key runs every bot. It is saved in your database and never sent back to the browser.</p>
                <div className="seg mt-4" role="group" aria-label="Provider">
                  {PROVIDER_IDS.map((id) => (
                    <button key={id} type="button" aria-pressed={provider === id} onClick={() => pickProvider(id)}>
                      {PROVIDERS[id].label}
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <input
                    type="password"
                    autoComplete="off"
                    aria-label={`${PROVIDERS[provider].label} API key`}
                    className="field w-full"
                    placeholder={hints[provider] ? `saved ${hints[provider]}, leave empty to use it` : `paste your ${PROVIDERS[provider].label} key`}
                    value={key}
                    onChange={(e) => onKeyInput(e.target.value)}
                  />
                  <button
                    type="submit"
                    disabled={status.kind === "busy"}
                    className="whitespace-nowrap rounded-lg bg-wine px-4 font-display tracking-wide ring-1 ring-gold/50 transition-colors hover:bg-[#5a121b] disabled:opacity-60"
                  >
                    {status.kind === "busy" ? "CHECKING…" : "CHECK MODELS"}
                  </button>
                </div>
                <p role="status" className={`mt-2 min-h-5 text-sm ${STATUS_COLORS[status.kind]}`}>
                  {status.text}
                </p>
                {models && (
                  <div className="anim-rise mt-3">
                    <h3 className="text-xs uppercase tracking-wider text-cream/50">Available models · click one to give it to every bot</h3>
                    <ul className="mt-2 flex max-h-56 flex-wrap gap-1.5 overflow-y-auto rounded-xl bg-black/25 p-2">
                      {models.map((model) => (
                        <li key={model.id}>
                          <button
                            type="button"
                            title={model.id}
                            onClick={() => setModel("all", model.id)}
                            className="rounded-full bg-black/35 px-2.5 py-1 text-xs ring-1 ring-gold/25 transition-colors hover:bg-[#5a121b] hover:ring-gold/60"
                          >
                            {model.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </form>

              <div>
                <h2 className="font-display text-2xl tracking-wide text-white">2 · BOTS</h2>
                <p className="mt-1 text-sm text-cream/70">You sit in seat 1. Pick a model for each bot, or one for all of them.</p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <div className="seg" role="group" aria-label="Players at the table">
                    {([5, 9] as const).map((count) => (
                      <button key={count} type="button" aria-pressed={seats === count} onClick={() => setSeats(count)}>
                        {count} players
                      </button>
                    ))}
                  </div>
                  <select
                    aria-label="Model for all bots"
                    disabled={!models}
                    className="field min-w-0 flex-1"
                    value=""
                    onChange={(e) => setModel("all", e.target.value)}
                  >
                    <option value="">{models ? "Same model for all bots…" : "Check your key to load models"}</option>
                    {models?.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                </div>
                <ol className="mt-3 space-y-2">
                  {bots.slice(1, seats).map((bot, k) => {
                    const seat = k + 1;
                    return (
                      <li key={seat} className="grid grid-cols-[4rem_1fr] items-center gap-2 rounded-xl bg-black/20 p-2 sm:grid-cols-[4rem_1fr_1.4fr]">
                        <span className="text-sm font-bold">Seat {seat + 1}</span>
                        <span className="truncate text-sm text-cream/85" title={bot.name}>
                          {bot.name}
                        </span>
                        <select
                          aria-label={`Seat ${seat + 1} model`}
                          disabled={!models}
                          className="field col-span-2 min-w-0 sm:col-span-1"
                          value={models ? bot.model : ""}
                          onChange={(e) => setModel(seat, e.target.value)}
                        >
                          {!models && <option value="">{bot.model}</option>}
                          {models?.map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.name}
                            </option>
                          ))}
                        </select>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
            <div className="mt-8 flex flex-wrap items-center justify-end gap-4">
              {!models && <span className="text-sm text-cream/60">Check your key first: the bots need a model it can use.</span>}
              <button onClick={start} disabled={!models || !cfg || starting} className="btn-gold disabled:cursor-not-allowed disabled:opacity-50">
                {starting ? "STARTING…" : "START MATCH"}
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
