"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { authClient } from "@/lib/auth-client";
import { HASH, HASH_DOMAIN, ID_HEADER, NEW_HASH_EMAIL, WRONG_HASH_LOGIN, hashOf, idHeaderValue } from "@/lib/hash-accounts";
import { TURNSTILE_SITE_KEY, Turnstile } from "../turnstile";
import { BrandName, SpadeBadge } from "../ui";

type Method = "hash" | "email";
type Mode = "signin" | "create";
type Creds = { id: string; password: string; hash: string };

const METHODS: [Method, string][] = [
  ["hash", "Hash ID"],
  ["email", "Email"],
];
const MODES: [Mode, string][] = [
  ["signin", "Sign in"],
  ["create", "Create account"],
];
const MIN_EMAIL_PASSWORD_LENGTH = 8;

/** Where to go after signing in: the page that sent you here, only if it resolves to this site ("/\evil.com" doesn't). */
function nextPath() {
  try {
    const url = new URL(new URLSearchParams(location.search).get("next") ?? "/", location.origin);
    return url.origin === location.origin ? url.pathname + url.search + url.hash : "/";
  } catch {
    return "/";
  }
}

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
  const safeId = id.replace(/[^\w-]+/g, "_") || "account";
  const link = Object.assign(document.createElement("a"), { href: url, download: `agent-holdem-${safeId}-${hash.slice(0, 8)}.txt` });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Sends the CAPTCHA token along with a sign-up. */
const withCaptcha = (token: string) => ({ fetchOptions: { headers: { "x-captcha-response": token } } });

/** The server makes the hash; the response carries it back as the account's email. */
async function createHashAccount(id: string, password: string, captchaToken: string): Promise<Creds> {
  const { data, error } = await authClient.signUp.email({ email: NEW_HASH_EMAIL, password, name: id, ...withCaptcha(captchaToken) });
  if (error) {
    throw new Error(error.message);
  }
  return { id: data.user.name, password, hash: hashOf(data.user.email) ?? "" };
}

async function signInWithHash(id: string, password: string, typedHash: string) {
  const hash = typedHash.trim().toLowerCase();
  if (!HASH.test(hash)) {
    throw new Error("A hash is 32 letters and digits, as in your account file.");
  }
  const { error } = await authClient.signIn.email({
    email: hash + HASH_DOMAIN,
    password,
    fetchOptions: { headers: { [ID_HEADER]: idHeaderValue(id) } },
  });
  if (error) {
    throw new Error(error.status === 429 ? error.message : WRONG_HASH_LOGIN); // never say which of the three was wrong
  }
}

async function createEmailAccount(name: string, email: string, password: string, captchaToken: string) {
  const { error } = await authClient.signUp.email({ email, password, name, ...withCaptcha(captchaToken) });
  if (error) {
    throw new Error(error.message);
  }
}

async function signInWithEmail(email: string, password: string) {
  const { error } = await authClient.signIn.email({ email, password });
  if (error) {
    throw new Error(error.message);
  }
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
  const update = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const captchaToken = captcha;
    if (mode === "create") {
      setCaptcha("");
      setCaptchaRound((round) => round + 1); // this token is spent, whatever happens next
    }
    try {
      if (method === "hash" && mode === "create") {
        const creds = await createHashAccount(form.id, form.password, captchaToken);
        downloadCredentials(creds);
        setCreated(creds);
        return;
      }
      if (method === "hash") {
        await signInWithHash(form.id, form.password, form.hash);
      } else if (mode === "create") {
        await createEmailAccount(form.name, form.email, form.password, captchaToken);
      } else {
        await signInWithEmail(form.email, form.password);
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
    const field = (label: string) => text.match(new RegExp(`^${label}: (.*)$`, "m"))?.[1] ?? "";
    const hash = field("Hash").trim();
    if (!HASH.test(hash)) {
      setError("That file doesn't look like an Agent Hold'em account file.");
      return;
    }
    setError("");
    update({ id: field("ID"), password: field("Password"), hash });
  };

  const pickMethod = (picked: Method) => {
    setMethod(picked);
    setError("");
  };
  const pickMode = (picked: Mode) => {
    setMode(picked);
    setError("");
  };

  if (created) {
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
  }

  const creating = mode === "create";
  let submitLabel = creating ? "CREATE ACCOUNT" : "SIGN IN";
  if (busy) {
    submitLabel = "ONE MOMENT…";
  }
  const passwordInput = (
    <input
      type="password"
      required
      minLength={method === "email" && creating ? MIN_EMAIL_PASSWORD_LENGTH : 1}
      autoComplete={creating ? "new-password" : "current-password"}
      className="field w-full text-lg"
      value={form.password}
      onChange={(e) => update({ password: e.target.value })}
    />
  );

  return (
    <Shell>
      <h1 className="font-display text-4xl font-bold tracking-wide text-white sm:text-5xl">{creating ? "CREATE ACCOUNT" : "SIGN IN"}</h1>
      {session && (
        <p className="mt-2 text-sm text-cream/75">
          Signed in as <b>{session.user.name}</b>.{" "}
          <Link href="/" className="underline hover:text-cream">
            Continue
          </Link>
        </p>
      )}
      <div role="tablist" aria-label="Account type" className="seg mx-auto mt-6 w-fit">
        {METHODS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={method === id} onClick={() => pickMethod(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="mx-auto mt-3 flex w-fit gap-1 rounded-full bg-black/30 p-1 text-sm">
        {MODES.map(([id, label]) => (
          <button
            key={id}
            aria-pressed={mode === id}
            onClick={() => pickMode(id)}
            className={`rounded-full px-4 py-1.5 transition-colors ${mode === id ? "bg-[#f0d9b5] text-wine" : "text-cream/80 hover:text-cream"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mx-auto mt-6 max-w-md space-y-4">
        {method === "hash" && (
          <>
            <p className="text-sm text-cream/70">
              {creating
                ? "Pick any ID and password, even ones other people use. We make a unique hash for your account and download a file with all three."
                : "Enter the ID, password and hash from your account file, or load the file."}
            </p>
            <Field label="ID">
              <input required maxLength={32} autoComplete="username" className="field w-full text-lg" value={form.id} onChange={(e) => update({ id: e.target.value })} />
            </Field>
            <Field label="Password">{passwordInput}</Field>
            {!creating && (
              <Field label="Hash">
                <input
                  required
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="32 letters and digits"
                  className="field w-full font-mono"
                  value={form.hash}
                  onChange={(e) => update({ hash: e.target.value })}
                />
              </Field>
            )}
            {!creating && (
              <label className="block cursor-pointer text-sm text-cream/75 underline hover:text-cream">
                Load my account file (.txt)
                <input type="file" accept=".txt,text/plain" className="sr-only" onChange={loadFile} />
              </label>
            )}
          </>
        )}
        {method === "email" && (
          <>
            {creating && (
              <Field label="Name">
                <input required maxLength={32} autoComplete="name" className="field w-full text-lg" value={form.name} onChange={(e) => update({ name: e.target.value })} />
              </Field>
            )}
            <Field label="Email">
              <input type="email" required autoComplete="email" className="field w-full text-lg" value={form.email} onChange={(e) => update({ email: e.target.value })} />
            </Field>
            <Field label={creating ? "Password (8 or more characters)" : "Password"}>{passwordInput}</Field>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-200">
            {error}
          </p>
        )}
        {creating && <Turnstile key={captchaRound} onToken={setCaptcha} />}
        <button disabled={busy || (creating && !!TURNSTILE_SITE_KEY && !captcha)} className="btn-gold w-full disabled:opacity-60">
          {submitLabel}
        </button>
      </form>
    </Shell>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-left text-sm">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-xl text-center">
        <div className="mb-6 flex items-center justify-center gap-2 font-display text-2xl tracking-wide">
          <SpadeBadge className="h-9 w-9" />
          <BrandName />
        </div>
        <div className="anim-modal panel p-6 sm:p-10">{children}</div>
      </div>
    </main>
  );
}
