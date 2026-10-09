"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { authClient } from "@/lib/auth-client";
import { TURNSTILE_SITE_KEY, Turnstile } from "../turnstile";
import { HASH, HASH_DOMAIN, ID_HEADER, ID_HEADER_VALUE, NEW_HASH_EMAIL, WRONG_HASH_LOGIN, hashOf } from "@/lib/hash-accounts";

type Method = "hash" | "email";
type Mode = "signin" | "create";
type Creds = { id: string; password: string; hash: string };

/** Where to go after signing in: the page that sent you here, only if it resolves to this site ("/\evil.com" doesn't). */
const nextPath = () => {
  try {
    const url = new URL(new URLSearchParams(location.search).get("next") ?? "/", location.origin);
    return url.origin === location.origin ? url.pathname + url.search + url.hash : "/";
  } catch {
    return "/";
  }
};

/** The account file a new hash account downloads; the Hash ID tab can read it back. */
function downloadCredentials({ id, password, hash }: Creds) {
  const text = [
    "Agent Hold'em account",
    "",
    `ID: ${id}`,
    `Password: ${password}`,
    `Hash: ${hash}`,
    "",
    "Sign in on the Hash ID tab with all three. Keep this file private: anyone who has it can sign in as you.",
    `Created: ${new Date().toISOString()}`,
    "",
  ].join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `agent-holdem-${id.replace(/[^\w-]+/g, "_") || "account"}-${hash.slice(0, 8)}.txt` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function LoginPage() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const [method, setMethod] = useState<Method>("hash");
  const [mode, setMode] = useState<Mode>("signin");
  const [form, setForm] = useState({ id: "", password: "", hash: "", email: "", name: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Creds | null>(null);
  const [captcha, setCaptcha] = useState(""); // Turnstile token for creating an account
  const [captchaRound, setCaptchaRound] = useState(0); // bump to get a fresh widget (tokens work once)
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const captchaHeaders = { fetchOptions: { headers: { "x-captcha-response": captcha } } };
    if (mode === "create") {
      setCaptcha("");
      setCaptchaRound((n) => n + 1); // this token is spent, whatever happens next
    }
    try {
      if (method === "hash" && mode === "create") {
        // The server makes the hash; the response carries it back as the account's email.
        const { data, error } = await authClient.signUp.email({ email: NEW_HASH_EMAIL, password: form.password, name: form.id, ...captchaHeaders });
        if (error) throw new Error(error.message);
        const creds = { id: data.user.name, password: form.password, hash: hashOf(data.user.email) ?? "" };
        downloadCredentials(creds);
        return setCreated(creds);
      }
      if (method === "hash") {
        const hash = form.hash.trim().toLowerCase();
        if (!HASH.test(hash)) throw new Error("A hash is 32 letters and digits, as in your account file.");
        const { error } = await authClient.signIn.email({
          email: hash + HASH_DOMAIN,
          password: form.password,
          fetchOptions: { headers: { [ID_HEADER]: ID_HEADER_VALUE(form.id) } },
        });
        if (error) throw new Error(error.status === 429 ? error.message : WRONG_HASH_LOGIN); // never say which of the three was wrong
      } else if (mode === "create") {
        const { error } = await authClient.signUp.email({ email: form.email, password: form.password, name: form.name, ...captchaHeaders });
        if (error) throw new Error(error.message);
      } else {
        const { error } = await authClient.signIn.email({ email: form.email, password: form.password });
        if (error) throw new Error(error.message);
      }
      router.push(nextPath());
    } catch (err) {
      setError((err as Error).message || "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  /** Fill the hash sign-in form from a downloaded account file. */
  const loadFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const text = (await e.target.files?.[0]?.text()) ?? "";
    const line = (label: string) => text.match(new RegExp(`^${label}: (.*)$`, "m"))?.[1] ?? "";
    const hash = line("Hash").trim();
    if (!HASH.test(hash)) return setError("That file doesn't look like an Agent Hold'em account file.");
    setError("");
    set({ id: line("ID"), password: line("Password"), hash });
  };

  if (created)
    return (
      <Shell>
        <h1 className="font-display text-4xl font-bold tracking-wide text-white">ACCOUNT CREATED</h1>
        <p className="mt-2 text-cream/80">Your account file was downloaded. You need all three to sign in, and a lost hash can&apos;t be recovered.</p>
        <dl className="mx-auto mt-6 grid max-w-md grid-cols-[5rem_1fr] gap-x-4 gap-y-2 rounded-xl bg-black/30 p-4 text-left ring-1 ring-gold/25">
          <dt className="text-cream/60">ID</dt>
          <dd className="break-all">{created.id}</dd>
          <dt className="text-cream/60">Password</dt>
          <dd>{"•".repeat(Math.min(12, created.password.length))} (in the file)</dd>
          <dt className="text-cream/60">Hash</dt>
          <dd className="break-all font-mono text-gold">{created.hash}</dd>
        </dl>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button onClick={() => downloadCredentials(created)} className="rounded-full px-5 py-2 ring-1 ring-gold/50 hover:bg-black/30">
            DOWNLOAD AGAIN
          </button>
          <button onClick={() => router.push(nextPath())} className="btn-gold">
            CONTINUE
          </button>
        </div>
      </Shell>
    );

  const field = (label: string, input: ReactNode) => (
    <label className="block text-left text-sm">
      {label}
      <div className="mt-1">{input}</div>
    </label>
  );
  const password = (
    <input
      type="password"
      required
      minLength={method === "email" && mode === "create" ? 8 : 1}
      autoComplete={mode === "create" ? "new-password" : "current-password"}
      className="field w-full text-lg"
      value={form.password}
      onChange={(e) => set({ password: e.target.value })}
    />
  );

  return (
    <Shell>
      <h1 className="font-display text-4xl font-bold tracking-wide text-white sm:text-5xl">{mode === "create" ? "CREATE ACCOUNT" : "SIGN IN"}</h1>
      {session && (
        <p className="mt-2 text-sm text-cream/75">
          Signed in as <b>{session.user.name}</b>.{" "}
          <Link href="/" className="underline hover:text-cream">
            Continue
          </Link>
        </p>
      )}
      <div role="tablist" aria-label="Account type" className="seg mx-auto mt-6 w-fit">
        {(
          [
            ["hash", "Hash ID"],
            ["email", "Email"],
          ] as const
        ).map(([m, label]) => (
          <button key={m} role="tab" aria-selected={method === m} onClick={() => (setMethod(m), setError(""))}>
            {label}
          </button>
        ))}
      </div>
      <div className="mx-auto mt-3 flex w-fit gap-1 rounded-full bg-black/30 p-1 text-sm">
        {(
          [
            ["signin", "Sign in"],
            ["create", "Create account"],
          ] as const
        ).map(([m, label]) => (
          <button key={m} aria-pressed={mode === m} onClick={() => (setMode(m), setError(""))} className={`rounded-full px-4 py-1.5 transition-colors ${mode === m ? "bg-[#f0d9b5] text-wine" : "text-cream/80 hover:text-cream"}`}>
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mx-auto mt-6 max-w-md space-y-4">
        {method === "hash" ? (
          <>
            <p className="text-sm text-cream/70">
              {mode === "create"
                ? "Pick any ID and password, even ones other people use. We make a unique hash for your account and download a file with all three."
                : "Enter the ID, password and hash from your account file, or load the file."}
            </p>
            {field("ID", <input required maxLength={32} autoComplete="username" className="field w-full text-lg" value={form.id} onChange={(e) => set({ id: e.target.value })} />)}
            {field("Password", password)}
            {mode === "signin" &&
              field(
                "Hash",
                <input required spellCheck={false} autoComplete="off" placeholder="32 letters and digits" className="field w-full font-mono" value={form.hash} onChange={(e) => set({ hash: e.target.value })} />,
              )}
            {mode === "signin" && (
              <label className="block cursor-pointer text-sm text-cream/75 underline hover:text-cream">
                Load my account file (.txt)
                <input type="file" accept=".txt,text/plain" className="sr-only" onChange={loadFile} />
              </label>
            )}
          </>
        ) : (
          <>
            {mode === "create" && field("Name", <input required maxLength={32} autoComplete="name" className="field w-full text-lg" value={form.name} onChange={(e) => set({ name: e.target.value })} />)}
            {field("Email", <input type="email" required autoComplete="email" className="field w-full text-lg" value={form.email} onChange={(e) => set({ email: e.target.value })} />)}
            {field(mode === "create" ? "Password (8 or more characters)" : "Password", password)}
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-200">
            {error}
          </p>
        )}
        {mode === "create" && <Turnstile key={captchaRound} onToken={setCaptcha} />}
        <button disabled={busy || (mode === "create" && !!TURNSTILE_SITE_KEY && !captcha)} className="btn-gold w-full disabled:opacity-60">
          {busy ? "ONE MOMENT…" : mode === "create" ? "CREATE ACCOUNT" : "SIGN IN"}
        </button>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-xl text-center">
        <div className="mb-6 flex items-center justify-center gap-2 font-display text-2xl tracking-wide">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-[#c4202c] text-white shadow ring-2 ring-gold/60">♠</span>
          AGENT <span className="text-gold">HOLD&apos;EM</span>
        </div>
        <div className="anim-modal panel p-6 sm:p-10">{children}</div>
      </div>
    </main>
  );
}
