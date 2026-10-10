// HTTP tests for the API routes and the sign-in guard, run against the real app and its database:
//   npm run build && npm start     (or npm run dev)
//   npm run test:api               (set BASE_URL to test another address)
// Every run signs up a few throwaway accounts. Friend tables wait out a real 30 s turn clock,
// so the suite takes about a minute. No request reaches an AI provider.
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { before, describe, test } from "node:test";
import { AGENT_LIMIT, newAgentLayout, REQUIRED_WIRES, type AgentSummary, type SavedAgent } from "../lib/built-agents.ts";
import { DEFAULTS, type Config } from "../lib/config.ts";
import type { HandRecord } from "../lib/poker.ts";
import type { TableView } from "../lib/tables.ts";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const CAPTCHA_CONFIGURED = Boolean(process.env.TURNSTILE_SECRET_KEY); // `npm run test:api` reads .env
const CAPTCHA_HEADERS = { "x-captcha-response": "test-token" }; // Cloudflare's test secret accepts any token
const WRONG_HASH_LOGIN = "ID, password or hash is wrong.";

type ErrorBody = { error?: string; message?: string };
type Reply<Body> = { status: number; body: Body; text: string; cookie: string; location: string | null };
type RequestOptions = {
  method?: string;
  body?: unknown;
  rawBody?: string;
  cookie?: string;
  headers?: Record<string, string>;
};

/** A made-up client address, so Better Auth's per-address rate limits don't trip across tests. */
const randomAddress = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(256)}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Call the app the way its own pages do (same-origin), and keep the session cookie it sets. */
async function request<Body = ErrorBody>(path: string, options: RequestOptions = {}): Promise<Reply<Body>> {
  const jsonBody = options.body === undefined ? undefined : JSON.stringify(options.body);
  const body = options.rawBody ?? jsonBody;
  const response = await fetch(BASE_URL + path, {
    method: options.method ?? (body === undefined ? "GET" : "POST"),
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      origin: BASE_URL,
      "sec-fetch-site": "same-origin",
      "x-forwarded-for": randomAddress(),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...options.headers,
    },
    body,
  });

  const text = await response.text();
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    // an HTML page or an empty body
  }
  const cookie = response.headers
    .getSetCookie()
    .map((setCookie) => setCookie.split(";")[0])
    .join("; ");
  return { status: response.status, body: parsed as Body, text, cookie, location: response.headers.get("location") };
}

type AuthBody = ErrorBody & { user?: { name: string; email: string } };

const uniqueEmail = () => `test-${randomUUID()}@example.com`;

function signUpEmail(name: string, email: string, password: string, headers: Record<string, string> = {}) {
  return request<AuthBody>("/api/auth/sign-up/email", {
    body: { name, email, password },
    headers: { ...CAPTCHA_HEADERS, ...headers },
  });
}

function signUpHash(id: string, password: string) {
  return request<AuthBody>("/api/auth/sign-up/email", {
    body: { email: "new@hash.invalid", name: id, password },
    headers: CAPTCHA_HEADERS,
  });
}

function signInHash(id: string, password: string, hash: string) {
  return request<AuthBody>("/api/auth/sign-in/email", {
    body: { email: `${hash}@hash.invalid`, password },
    headers: { "x-hash-id": encodeURIComponent(id) },
  });
}

/** A fresh email account, signed in; returns its session cookie. */
async function newSession(name = "Tester"): Promise<string> {
  const reply = await signUpEmail(name, uniqueEmail(), "longenough");
  assert.equal(reply.status, 200, reply.text);
  assert.match(reply.cookie, /session_token/);
  return reply.cookie;
}

before(async () => {
  try {
    await fetch(`${BASE_URL}/login`);
  } catch {
    throw new Error(`No app at ${BASE_URL}. Start it (npm run build && npm start) or set BASE_URL.`);
  }
});

describe("signed-out visitors", () => {
  test("pages redirect to the login page, remembering where you were going", async () => {
    for (const path of ["/", "/play", "/history", "/t/0123abcd"]) {
      const reply = await request(path);
      assert.equal(reply.status, 307, path);
      const target = new URL(reply.location ?? "", BASE_URL);
      assert.equal(target.pathname, "/login", path);
      assert.equal(target.searchParams.get("next"), path);
    }
  });

  test("the login page itself is open", async () => {
    assert.equal((await request("/login")).status, 200);
  });

  test("every API route asks you to sign in", async () => {
    const routes: [string, string][] = [
      ["GET", "/api/settings"],
      ["PUT", "/api/settings"],
      ["POST", "/api/agent"],
      ["POST", "/api/models"],
      ["POST", "/api/models/check"],
      ["POST", "/api/hands"],
      ["POST", "/api/tables"],
      ["GET", "/api/tables/0123abcd"],
      ["POST", "/api/tables/0123abcd"],
    ];
    for (const [method, path] of routes) {
      const reply = await request(path, { method, body: method === "GET" ? undefined : {} });
      assert.equal(reply.status, 401, `${method} ${path}`);
      assert.equal(reply.body.error, "Sign in first.");
    }
  });
});

describe("accounts", () => {
  test("creating an account needs the CAPTCHA", { skip: !CAPTCHA_CONFIGURED && "TURNSTILE_SECRET_KEY is not set" }, async () => {
    const reply = await request<AuthBody>("/api/auth/sign-up/email", {
      body: { email: "new@hash.invalid", name: "bot", password: "x" },
    });
    assert.equal(reply.status, 400);
    assert.match(reply.body.message ?? "", /captcha/i);
  });

  test("hash accounts: the server picks the hash; signing in takes the ID, password and hash", async () => {
    const first = await signUpHash("  Sø 🃏  king ", "pw");
    assert.equal(first.status, 200, first.text);
    assert.match(first.cookie, /session_token/);
    assert.equal(first.body.user?.name, "Sø 🃏 king");
    const hash = first.body.user?.email.replace("@hash.invalid", "") ?? "";
    assert.match(hash, /^[0-9a-f]{32}$/);

    const second = await signUpHash("Sø 🃏 king", "pw");
    assert.equal(second.status, 200, second.text);
    assert.notEqual(second.body.user?.email, first.body.user?.email, "same ID and password, different account");

    const signedIn = await signInHash("Sø 🃏 king", "pw", hash);
    assert.equal(signedIn.status, 200, signedIn.text);
    assert.match(signedIn.cookie, /session_token/);

    for (const [id, password, wrongHash] of [
      ["Sø 🃏 kin", "pw", hash],
      ["", "pw", hash],
      ["Sø 🃏 king", "pw", "0".repeat(32)],
    ]) {
      const reply = await signInHash(id, password, wrongHash);
      assert.equal(reply.status, 401, `${id} / ${wrongHash}`);
      assert.equal(reply.body.message, WRONG_HASH_LOGIN);
    }
    assert.equal((await signInHash("Sø 🃏 king", "nope", hash)).status, 401, "wrong password");
  });

  test("you can't choose your own hash", async () => {
    const reply = await signUpEmail("x", `${"a".repeat(32)}@hash.invalid`, "pw");
    assert.equal(reply.status, 400);
    assert.match(reply.body.message ?? "", /reserved/);
  });

  test("email accounts: an 8+ character password, then sign in and sign out", async () => {
    const email = uniqueEmail();
    const short = await signUpEmail("Ann", email, "short");
    assert.equal(short.status, 400);
    assert.equal(short.body.message, "Email accounts need a password of at least 8 characters.");

    const created = await signUpEmail("Ann", email, "longenough");
    assert.equal(created.status, 200, created.text);
    assert.equal(created.body.user?.name, "Ann");

    const wrong = await request("/api/auth/sign-in/email", { body: { email, password: "wrongpassword" } });
    assert.equal(wrong.status, 401);

    const signedIn = await request("/api/auth/sign-in/email", { body: { email, password: "longenough" } });
    assert.equal(signedIn.status, 200, signedIn.text);
    assert.equal((await request("/api/settings", { cookie: signedIn.cookie })).status, 200);

    const signedOut = await request("/api/auth/sign-out", { cookie: signedIn.cookie, body: {} });
    assert.equal(signedOut.status, 200);
    assert.equal((await request("/api/settings", { cookie: signedIn.cookie })).status, 401, "old session refused");
  });

  test("one address can create at most three accounts a minute", async () => {
    const sameAddress = { "x-forwarded-for": randomAddress() };
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await signUpEmail("Spam", uniqueEmail(), "longenough", sameAddress)).status);
    }
    assert.deepEqual(statuses, [200, 200, 200, 429]);
  });
});

describe("settings and API keys", () => {
  type SettingsBody = ErrorBody & { config: Config; keys: Record<string, string> };
  let sam = "";
  let ann = "";

  const getSettings = (cookie: string) => request<SettingsBody>("/api/settings", { cookie });
  const putSettings = (cookie: string, body: unknown) => request<SettingsBody>("/api/settings", { method: "PUT", cookie, body });

  before(async () => {
    sam = await newSession("Sam");
    ann = await newSession("Ann");
  });

  test("a new account starts with the default settings and no keys", async () => {
    const reply = await getSettings(sam);
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body.config, DEFAULTS);
    assert.deepEqual(reply.body.keys, {});
  });

  test("saved keys only ever come back as masked hints", async () => {
    const saved = await putSettings(sam, { keys: { openrouter: "  sk-or-v1-test-key-1234  " } });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.keys, { openrouter: "••••1234" });
    assert(!saved.text.includes("sk-or-v1-test-key"));

    const read = await getSettings(sam);
    assert.deepEqual(read.body.keys, { openrouter: "••••1234" });
    assert(!read.text.includes("sk-or-v1-test-key"));
  });

  test("settings and keys belong to one account", async () => {
    assert.deepEqual((await getSettings(ann)).body.keys, {});
    const annSaved = await putSettings(ann, { config: { seats: 9 } });
    assert.equal(annSaved.body.config.seats, 9);
    assert.equal((await getSettings(sam)).body.config.seats, 5);
  });

  test("settings are cleaned before they are saved", async () => {
    const reply = await putSettings(ann, { config: { seats: 12, bb: 1, stack: 1, speed: "warp", agents: [{ provider: "bogus" }] } });
    assert.equal(reply.status, 200);
    assert.equal(reply.body.config.seats, 9, "at most 9 players");
    assert.equal(reply.body.config.bb, 2);
    assert.equal(reply.body.config.stack, 2);
    assert.equal(reply.body.config.speed, "normal");
    assert.equal(reply.body.config.agents[0].provider, DEFAULTS.agents[0].provider);
  });

  test("a null or blank key deletes it; keys left out stay; config left out stays", async () => {
    const added = await putSettings(sam, { keys: { anthropic: "sk-ant-abcd9999" } });
    assert.deepEqual(added.body.keys, { anthropic: "••••9999", openrouter: "••••1234" });

    const removed = await putSettings(sam, { keys: { anthropic: null } });
    assert.deepEqual(removed.body.keys, { openrouter: "••••1234" });

    const blanked = await putSettings(sam, { keys: { openrouter: "   " } });
    assert.deepEqual(blanked.body.keys, {});
    assert.deepEqual(blanked.body.config, DEFAULTS);
  });

  test("bad key ids, oversized keys and malformed bodies are refused", async () => {
    const cases: [unknown, string][] = [
      [{ keys: { google: "x" } }, "bad key google"],
      [{ keys: { "seat:9": "x" } }, "bad key seat:9"],
      [{ keys: { openai: "x".repeat(401) } }, "bad key openai"],
      [{ keys: { openai: 5 } }, "bad key openai"],
      [null, "bad request"],
    ];
    for (const [body, error] of cases) {
      const reply = await putSettings(sam, body);
      assert.equal(reply.status, 400, JSON.stringify(body));
      assert.equal(reply.body.error, error);
    }
    const notJson = await request("/api/settings", { method: "PUT", cookie: sam, rawBody: "not json" });
    assert.equal(notJson.status, 400);
  });

  test("requests from other sites are refused", async () => {
    const reply = await request("/api/settings", { cookie: sam, headers: { "sec-fetch-site": "cross-site" } });
    assert.equal(reply.status, 403);
    assert.equal(reply.body.error, "forbidden");
  });
});

describe("AI agent and model routes (local checks only)", () => {
  let cookie = "";

  before(async () => {
    cookie = await newSession();
  });

  test("an agent turn needs a valid seat, a prompt and a saved key", async () => {
    const badRequests = [{}, { seat: 1.5, prompt: "hi" }, { seat: 3, prompt: 5 }, { seat: 3, prompt: "x".repeat(20_001) }, { seat: 9, prompt: "hi" }];
    for (const body of badRequests) {
      const reply = await request("/api/agent", { cookie, body });
      assert.equal(reply.status, 400, JSON.stringify(body).slice(0, 60));
      assert.equal(reply.body.error, "bad request");
    }
    const noKey: [number, string][] = [
      [1, "no Anthropic API key saved"],
      [2, "no OpenAI API key saved"],
      [3, "no OpenRouter API key saved"],
    ];
    for (const [seat, error] of noKey) {
      const reply = await request("/api/agent", { cookie, body: { seat, prompt: "hi" } });
      assert.equal(reply.status, 400);
      assert.equal(reply.body.error, error);
    }
  });

  test("listing models needs a known provider and a key", async () => {
    for (const provider of ["google", "toString", 5]) {
      const reply = await request("/api/models", { cookie, body: { provider } });
      assert.equal(reply.status, 400, String(provider));
      assert.equal(reply.body.error, "bad request");
    }
    for (const body of [{ provider: "openai" }, { provider: "openai", key: "   " }]) {
      const reply = await request("/api/models", { cookie, body });
      assert.equal(reply.status, 400);
      assert.equal(reply.body.error, "Enter your OpenAI API key.");
    }
  });

  test("checking one model needs a known provider, a model, a valid effort and a key", async () => {
    const badRequests = [
      { provider: "google", model: "x" },
      { provider: "openai" },
      { provider: "openai", model: "   " },
      { provider: "openai", model: "m".repeat(121) },
      { provider: "openai", model: "gpt-6-sol", effort: "extreme" },
    ];
    for (const body of badRequests) {
      const reply = await request("/api/models/check", { cookie, body });
      assert.equal(reply.status, 400, JSON.stringify(body).slice(0, 80));
      assert.equal(reply.body.error, "bad request");
    }
    const noKey = await request("/api/models/check", { cookie, body: { provider: "anthropic", model: "claude-haiku-5-5", effort: "low" } });
    assert.equal(noKey.status, 400);
    assert.equal(noKey.body.error, "Enter your Anthropic API key.");
  });
});

describe("built agents", () => {
  type AgentBody = ErrorBody & { agent?: SavedAgent; agents?: AgentSummary[] };
  let cookie = "";

  const agentInput = (name: string) => ({
    name,
    prompt: "Play tight and aggressive.",
    provider: "anthropic",
    model: "claude-haiku-5-5",
    effort: "low",
    layout: { ...newAgentLayout(), wires: REQUIRED_WIRES },
  });

  async function createAgent(name: string, owner = cookie): Promise<SavedAgent> {
    const reply = await request<AgentBody>("/api/agents", { cookie: owner, body: agentInput(name) });
    assert.equal(reply.status, 201, reply.text);
    assert.ok(reply.body.agent);
    return reply.body.agent;
  }

  before(async () => {
    cookie = await newSession();
  });

  test("an agent can be created, listed, read, edited and deleted", async () => {
    const created = await createAgent("River Shark");
    assert.equal(created.prompt, "Play tight and aggressive.");

    const list = await request<AgentBody>("/api/agents", { cookie });
    assert.deepEqual(
      list.body.agents?.map((agent) => agent.name),
      ["River Shark"],
    );

    const read = await request<AgentBody>(`/api/agents/${created.id}`, { cookie });
    assert.equal(read.status, 200);
    assert.deepEqual(read.body.agent?.layout.wires, REQUIRED_WIRES);

    const edited = await request<AgentBody>(`/api/agents/${created.id}`, {
      cookie,
      method: "PUT",
      body: { ...agentInput("River Whale"), prompt: "Bluff every river." },
    });
    assert.equal(edited.status, 200, edited.text);
    assert.equal(edited.body.agent?.name, "River Whale");
    assert.equal(edited.body.agent?.prompt, "Bluff every river.");

    const deleted = await request(`/api/agents/${created.id}`, { cookie, method: "DELETE" });
    assert.equal(deleted.status, 204);
    const gone = await request(`/api/agents/${created.id}`, { cookie });
    assert.equal(gone.status, 404);
  });

  test("another account can't read, edit, test or delete your agent", async () => {
    const mine = await createAgent("Private Agent");
    const stranger = await newSession("Stranger");
    const attempts = [
      request(`/api/agents/${mine.id}`, { cookie: stranger }),
      request(`/api/agents/${mine.id}`, { cookie: stranger, method: "PUT", body: agentInput("Stolen") }),
      request(`/api/agents/${mine.id}`, { cookie: stranger, method: "DELETE" }),
      request(`/api/agents/${mine.id}/test`, { cookie: stranger, body: { turnSeconds: 30 } }),
    ];
    for (const reply of await Promise.all(attempts)) {
      assert.equal(reply.status, 404, reply.text);
    }
    const strangerList = await request<AgentBody>("/api/agents", { cookie: stranger });
    assert.deepEqual(strangerList.body.agents, []);
    const stillMine = await request<AgentBody>(`/api/agents/${mine.id}`, { cookie });
    assert.equal(stillMine.body.agent?.name, "Private Agent");
  });

  test("names are unique per account", async () => {
    const first = await createAgent("Twin");
    const again = await request("/api/agents", { cookie, body: agentInput("Twin") });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'You already have an agent named "Twin".');

    const other = await createAgent("Not Twin");
    const rename = await request(`/api/agents/${other.id}`, { cookie, method: "PUT", body: agentInput("Twin") });
    assert.equal(rename.status, 409);
    await request(`/api/agents/${first.id}`, { cookie, method: "DELETE" });
    await request(`/api/agents/${other.id}`, { cookie, method: "DELETE" });

    const someoneElse = await newSession("Someone Else");
    await createAgent("Twin", someoneElse);
  });

  test(`an account can have at most ${AGENT_LIMIT} agents`, async () => {
    const owner = await newSession("Collector");
    for (let n = 1; n <= AGENT_LIMIT; n++) {
      await createAgent(`Agent ${n}`, owner);
    }
    const oneTooMany = await request("/api/agents", { cookie: owner, body: agentInput("Agent 11") });
    assert.equal(oneTooMany.status, 409);
    assert.equal(oneTooMany.body.error, `You have ${AGENT_LIMIT} agents; delete one first.`);
  });

  test("an incomplete or malformed agent is refused with the reason", async () => {
    const cases: [unknown, string][] = [
      [{ ...agentInput("No Wires"), layout: newAgentLayout() }, "Connect the Table state to the Model."],
      [{ ...agentInput("Blank"), prompt: "  " }, "Write the agent's prompt."],
      [{ ...agentInput("Nobody"), provider: "acme" }, "Choose a provider for the model."],
      [{ ...agentInput(""), prompt: "x" }, "Give the agent a name of 1 to 24 characters."],
      [null, "Give the agent a name of 1 to 24 characters."],
    ];
    for (const [body, error] of cases) {
      const reply = await request("/api/agents", { cookie, body });
      assert.equal(reply.status, 400, JSON.stringify(body).slice(0, 60));
      assert.equal(reply.body.error, error);
    }
  });

  test("testing an agent needs a listed turn time and a saved key for its provider", async () => {
    const agent = await createAgent("Tester Agent");
    for (const turnSeconds of [7, "30", undefined]) {
      const reply = await request(`/api/agents/${agent.id}/test`, { cookie, body: { turnSeconds } });
      assert.equal(reply.status, 400, String(turnSeconds));
      assert.match(reply.body.error ?? "", /^Pick a turn time of 5, 10, 15/);
    }
    const noKey = await request(`/api/agents/${agent.id}/test`, { cookie, body: { turnSeconds: 30 } });
    assert.equal(noKey.status, 400);
    assert.equal(noKey.body.error, "Add your Anthropic API key first.");
  });

  test("agents need a signed-in session from the app's own page", async () => {
    const signedOut = await request("/api/agents", { body: agentInput("Anon") });
    assert.equal(signedOut.status, 401);
    const crossSite = await request("/api/agents", { cookie, headers: { "sec-fetch-site": "cross-site" } });
    assert.equal(crossSite.status, 403);
  });
});

describe("hand history", () => {
  let owner = "";
  let other = "";

  before(async () => {
    owner = await newSession();
    other = await newSession();
  });

  const handFor = (player: string): HandRecord => ({
    number: 1,
    board: ["Ah", "Kd", "7c", "2s", "9h"],
    history: ["preflop: test line"],
    players: [{ name: player, cards: ["As", "Ad"], delta: 40, stack: 1040 }],
    winners: [{ name: player, amount: 80, hand: "Three of a Kind", cards: ["As", "Ad", "Ah", "Kd", "9h"] }],
  });

  test("a finished hand is saved and shows only in its own account's history", async () => {
    const player = `Player${randomInt(1e9)}`;
    const body = { gameId: randomUUID(), hand: handFor(player) };
    const saved = await request("/api/hands", { cookie: owner, body });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body, { ok: true });
    const again = await request("/api/hands", { cookie: owner, body });
    assert.equal(again.status, 200, "saving the same hand twice is fine");

    const page = await request("/history", { cookie: owner });
    assert.equal(page.status, 200);
    assert(page.text.includes(player), "owner sees the hand");
    assert(!(await request("/history", { cookie: other })).text.includes(player), "other accounts don't");
  });

  test("malformed or oversized hands are refused", async () => {
    const hand = handFor("Someone");
    const badBodies = [
      { gameId: "bad id!", hand },
      { gameId: "g".repeat(65), hand },
      { gameId: 7, hand },
      { gameId: "game", hand: { ...hand, number: 0 } },
      { gameId: "game", hand: { ...hand, number: 1.5 } },
      { gameId: "game", hand: { ...hand, winners: undefined } },
      { gameId: "game" },
    ];
    for (const body of badBodies) {
      const reply = await request("/api/hands", { cookie: owner, body });
      assert.equal(reply.status, 400, JSON.stringify(body).slice(0, 80));
    }
    assert.equal((await request("/api/hands", { cookie: owner, rawBody: "{" })).status, 400);

    const huge = { gameId: "game", hand: { ...hand, history: ["x".repeat(100_001)] } };
    assert.equal((await request("/api/hands", { cookie: owner, body: huge })).status, 413);
  });
});

describe("friend tables", () => {
  type Created = ErrorBody & { code: string; token: string };
  type Joined = ErrorBody & { token: string; view: TableView };
  type Acted = ErrorBody & { view: TableView };
  let anaCookie = "";
  let benCookie = "";

  const createTable = (body: object) => request<Created>("/api/tables", { cookie: anaCookie, body });
  const readTable = (code: string, token = "") =>
    request<TableView & ErrorBody>(`/api/tables/${code}`, { cookie: anaCookie, headers: { "x-table-token": token } });
  const postTable = <Body,>(code: string, token: string, body: object) =>
    request<Body & ErrorBody>(`/api/tables/${code}`, { cookie: benCookie, body, headers: { "x-table-token": token } });
  const join = (code: string, name: string, token = "") => postTable<Joined>(code, token, { op: "join", name });
  const deal = (code: string, token: string) => postTable<Acted>(code, token, { op: "deal" });
  const act = (code: string, token: string, action: object) => postTable<Acted>(code, token, { op: "act", action });

  /** A dealt heads-up table: Ana hosts in seat 0, Ben sits in seat 1. */
  async function headsUpTable(stack = 500) {
    const { body: created } = await createTable({ name: "Ana", stack, bb: 20 });
    const { body: joined } = await join(created.code, "Ben");
    const { body: dealt } = await deal(created.code, created.token);
    return { code: created.code, tokens: [created.token, joined.token], view: dealt.view };
  }

  before(async () => {
    anaCookie = await newSession("Ana");
    benCookie = await newSession("Ben");
  });

  test("creating a table needs a name; chips and blinds are kept in range", async () => {
    const nameless = await createTable({ name: "   " });
    assert.equal(nameless.status, 400);
    assert.equal(nameless.body.error, "Enter your name.");

    const defaults = await createTable({ name: "Ana" });
    assert.equal(defaults.status, 200);
    const defaultView = (await readTable(defaults.body.code, defaults.body.token)).body;
    assert.equal(defaultView.bb, 20);
    assert.equal(defaultView.stack, 1000);

    const clamped = await createTable({ name: "Ana", stack: 5, bb: 1 });
    const clampedView = (await readTable(clamped.body.code, clamped.body.token)).body;
    assert.equal(clampedView.bb, 2);
    assert.equal(clampedView.stack, 20, "at least ten big blinds");
  });

  test("host, visitors and joining", async () => {
    const created = await createTable({ name: "Ana", stack: 500, bb: 20 });
    assert.equal(created.status, 200);
    const { code, token: anaToken } = created.body;
    assert.match(code, /^[0-9a-f]{8}$/);

    const host = (await readTable(code, anaToken)).body;
    assert.equal(host.you, 0);
    assert.deepEqual(host.names, ["Ana"]);
    assert.equal(host.game, null);
    assert.equal(host.stack, 500);

    assert.equal((await readTable(code)).body.you, -1, "no token: you see the lobby without a seat");

    const ben = await join(code, "Ben");
    assert.equal(ben.status, 200);
    assert.equal(ben.body.view.you, 1);
    assert.deepEqual(ben.body.view.names, ["Ana", "Ben"]);

    const twice = await join(code, "Ben again", ben.body.token);
    assert.equal(twice.status, 409);
    assert.equal(twice.body.error, "You're already at this table.");
    assert.equal((await join(code, "  ")).status, 400);
  });

  test("only the host deals, once, and not alone", async () => {
    const solo = (await createTable({ name: "Ana" })).body;
    const alone = await deal(solo.code, solo.token);
    assert.equal(alone.status, 409);
    assert.equal(alone.body.error, "Wait for at least one friend to join.");

    const { code, token: anaToken } = (await createTable({ name: "Ana" })).body;
    const benToken = (await join(code, "Ben")).body.token;
    const early = await act(code, anaToken, { type: "check" });
    assert.equal(early.status, 409);
    assert.equal(early.body.error, "The game hasn't started yet.");

    const notHost = await deal(code, benToken);
    assert.equal(notHost.status, 403);
    assert.equal(notHost.body.error, "Only the host can deal.");

    const dealt = await deal(code, anaToken);
    assert.equal(dealt.status, 200);
    assert.equal(dealt.body.view.game?.hand, 1);
    assert.equal(dealt.body.view.game?.street, "preflop");

    const again = await deal(code, anaToken);
    assert.equal(again.status, 409);
    assert.equal(again.body.error, "The game has already started.");

    const stranger = await act(code, "", { type: "check" });
    assert.equal(stranger.status, 403);
    assert.equal(stranger.body.error, "You're not seated at this table.");
  });

  test("a hand from deal to showdown, the next deal, and the turn clock", async () => {
    const { code, tokens } = await headsUpTable(1000);

    const anaView = (await readTable(code, tokens[0])).body;
    const benView = (await readTable(code, tokens[1])).body;
    const anaGame = anaView.game;
    const benGame = benView.game;
    assert(anaGame && benGame);
    assert(anaGame.players[0].cards.every(Boolean), "Ana sees her own cards");
    assert(anaGame.players[1].cards.every((card) => card === ""), "but not Ben's");
    assert(benGame.players[1].cards.every(Boolean), "Ben sees his own cards");
    assert(benGame.players[0].cards.every((card) => card === ""), "but not Ana's");
    assert.equal(anaGame.deck.length + benGame.deck.length, 0, "nobody receives the deck");
    assert.equal(anaView.turnMs, 30_000);
    assert(anaView.turnMsLeft > 0 && anaView.turnMsLeft <= 30_000);

    const waiting = tokens[1 - anaGame.turn];
    const outOfTurn = await act(code, waiting, { type: "call" });
    assert.equal(outOfTurn.status, 409);
    assert.equal(outOfTurn.body.error, "It's not your turn.");
    const unknown = await act(code, tokens[anaGame.turn], { type: "dance" });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error, "bad request");
    assert.equal((await postTable(code, tokens[0], { op: "shuffle" })).status, 400);

    let game = anaGame;
    for (let step = 0; step < 20 && game.street !== "done"; step++) {
      const reply = await act(code, tokens[game.turn], { type: "call" });
      assert.equal(reply.status, 200, reply.text);
      assert(reply.body.view.game);
      game = reply.body.view.game;
    }
    assert.equal(game.street, "done");
    assert(game.winners.length > 0);
    assert.equal(
      game.players.reduce((sum, player) => sum + player.stack, 0),
      2000,
    );
    const benAtShowdown = (await readTable(code, tokens[1])).body.game;
    assert(benAtShowdown?.players.every((player) => player.cards.every(Boolean)), "showdown cards are face up for everyone");

    await sleep(5_500);
    const next = (await readTable(code, tokens[1])).body.game;
    assert(next);
    assert.equal(next.hand, 2, "the next hand deals itself about 5 s later");
    assert.equal(next.street, "preflop");

    const historyBefore = next.history.length;
    const slowSeat = next.turn;
    await sleep(31_000);
    const afterTimeout = (await readTable(code, tokens[0])).body;
    const timedOutLine = afterTimeout.game?.history[historyBefore] ?? "";
    assert(timedOutLine.includes(afterTimeout.names[slowSeat]), `the clock acted for the slow player: "${timedOutLine}"`);
    assert.match(timedOutLine, / (checks|folds)$/);
  });

  test("late joiners sit out until the next hand; nine seats at most; names stay unique", async () => {
    const { code, tokens } = await headsUpTable();
    for (const name of ["Ana", "C", "D", "E", "F", "G", "H"]) {
      assert.equal((await join(code, name)).status, 200, name);
    }
    const full = await join(code, "J");
    assert.equal(full.status, 409);
    assert.equal(full.body.error, "This table is full.");

    const view = (await readTable(code, tokens[0])).body;
    assert.deepEqual(view.names, ["Ana", "Ben", "Ana 2", "C", "D", "E", "F", "G", "H"]);
    assert(view.game?.players.slice(2).every((player) => player.cards.length === 0));
  });

  test("rebuys: only once you're out of chips", async () => {
    const { code, tokens } = await headsUpTable(500);
    const tooEarly = await act(code, tokens[0], { type: "rebuy" });
    assert.equal(tooEarly.status, 409);
    assert.equal(tooEarly.body.error, "You can rebuy once you're out of chips.");

    let busted = -1;
    for (let hand = 0; hand < 5 && busted < 0; hand++) {
      let game = (await readTable(code, tokens[0])).body.game;
      assert(game);
      await act(code, tokens[game.turn], { type: "raise", amount: 1e9 });
      game = (await readTable(code, tokens[0])).body.game;
      assert(game);
      if (game.street !== "done") {
        await act(code, tokens[game.turn], { type: "call" });
        game = (await readTable(code, tokens[0])).body.game;
        assert(game);
      }
      busted = game.players.findIndex((player) => player.stack === 0);
      if (busted < 0) {
        await sleep(5_500); // a split pot: wait for the next deal and go again
      }
    }
    assert(busted >= 0, "someone busted");

    const rebuy = await act(code, tokens[busted], { type: "rebuy" });
    assert.equal(rebuy.status, 200, rebuy.text);
    const player = rebuy.body.view.game?.players[busted];
    assert.equal(player?.stack, 500);
    assert.equal(player?.rebuys, 1);
    assert.equal(player?.buyIn, 1000);
  });

  test("unknown table codes are not found", async () => {
    for (const code of ["nothere1", "00000000", "ZZZZ%2e%2e"]) {
      const reply = await readTable(code);
      assert.equal(reply.status, 404, code);
      assert.equal(reply.body.error, "No table with that code.");
    }
  });
});
