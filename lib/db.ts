// Server-only Postgres store via Prisma. Settings, API keys, hands and built agents belong to one account (userId) each.
import { PrismaPg } from "@prisma/adapter-pg";
import { AGENT_LIMIT, type AgentInput, type AgentLayout, type AgentSummary, type SavedAgent } from "./built-agents";
import { normalize, type Config, type Effort, type Provider } from "./config";
import { PrismaClient, type Prisma } from "./generated/prisma/client";
import type { HandRecord } from "./poker";

// One client per process; dev hot reload would otherwise open a new pool on every edit.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = (globalForPrisma.prisma ??= new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
}));
// ponytail: keys stored in plaintext; encrypt at rest before running this anywhere shared

export async function getConfig(userId: string): Promise<Config> {
  const row = await prisma.settings.findUnique({ where: { userId } });
  return normalize(row?.config);
}

export async function getKey(userId: string, id: string): Promise<string | undefined> {
  const row = await prisma.apiKey.findUnique({ where: { userId_id: { userId, id } } });
  return row?.key;
}

/** A key typed into the request (trimmed, at most 400 characters), or else this account's saved key for the provider. */
export async function typedOrSavedKey(userId: string, provider: string, typed: unknown): Promise<string | undefined> {
  const typedKey = typeof typed === "string" ? typed.trim().slice(0, 400) : "";
  return typedKey || (await getKey(userId, provider));
}

/** The seat's own key if it has one, else the provider key - both from this account only. */
export async function getAgentKey(userId: string, seat: number, provider: string): Promise<string | undefined> {
  const seatKeyId = `seat:${seat}`;
  const rows = await prisma.apiKey.findMany({ where: { userId, id: { in: [seatKeyId, provider] } } });
  const seatKey = rows.find((row) => row.id === seatKeyId);
  return (seatKey ?? rows[0])?.key;
}

/** Which keys this account has set, as masked hints - raw keys never leave the server. */
export async function keyHints(userId: string): Promise<Record<string, string>> {
  const rows = await prisma.apiKey.findMany({ where: { userId } });
  return Object.fromEntries(rows.map((row) => [row.id, `••••${row.key.slice(-4)}`]));
}

/** Save this account's config (if given) and key edits atomically; a null key deletes it. */
export async function saveSettings(userId: string, config: Config | undefined, keys: [string, string | null][]) {
  const configWrites = config ? [prisma.settings.upsert({ where: { userId }, create: { userId, config }, update: { config } })] : [];
  const keyWrites = keys.map(([id, key]) => {
    if (key === null) {
      return prisma.apiKey.deleteMany({ where: { userId, id } });
    }
    return prisma.apiKey.upsert({
      where: { userId_id: { userId, id } },
      create: { userId, id, key },
      update: { key },
    });
  });
  await prisma.$transaction([...configWrites, ...keyWrites]);
}

/** Store a finished hand once; a repeat save of the same game + hand number is ignored. */
export async function saveHand(userId: string, gameId: string, hand: HandRecord) {
  const data = hand as unknown as Prisma.InputJsonObject;
  await prisma.hand.upsert({
    where: { gameId_number: { gameId, number: hand.number } },
    create: { userId, gameId, number: hand.number, data },
    update: {},
  });
}

export async function recentHands(userId: string, limit = 200) {
  const rows = await prisma.hand.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit });
  return rows.map((row) => ({ gameId: row.gameId, at: row.createdAt, hand: row.data as unknown as HandRecord }));
}

// ---- built agents ----

type AgentRow = Prisma.AgentGetPayload<object>;

/** Rows only ever hold agents that passed checkAgentInput, so their provider, effort and layout are known to be valid. */
function toSavedAgent(row: AgentRow): SavedAgent {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    provider: row.provider as Provider,
    model: row.model,
    effort: row.effort as Effort,
    layout: row.layout as unknown as AgentLayout,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Prisma's error code for a failed query: P2002 = a unique field is taken, P2025 = the row to change doesn't exist. */
const prismaErrorCode = (error: unknown) => (error as { code?: unknown } | null)?.code;

const agentData = (input: AgentInput) => ({ ...input, layout: input.layout as unknown as Prisma.InputJsonObject });

export async function listAgents(userId: string): Promise<AgentSummary[]> {
  const rows = await prisma.agent.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } });
  return rows.map((row) => {
    const { id, name, provider, model, effort, updatedAt } = toSavedAgent(row);
    return { id, name, provider, model, effort, updatedAt };
  });
}

export async function getAgent(userId: string, id: string): Promise<SavedAgent | null> {
  const row = await prisma.agent.findFirst({ where: { id, userId } });
  return row && toSavedAgent(row);
}

export async function createAgent(userId: string, input: AgentInput): Promise<SavedAgent | "limit" | "duplicate name"> {
  // ponytail: two creates at the same moment can both pass this count; a serializable transaction closes that if it matters
  const count = await prisma.agent.count({ where: { userId } });
  if (count >= AGENT_LIMIT) {
    return "limit";
  }
  try {
    return toSavedAgent(await prisma.agent.create({ data: { userId, ...agentData(input) } }));
  } catch (error) {
    if (prismaErrorCode(error) === "P2002") {
      return "duplicate name";
    }
    throw error;
  }
}

export async function updateAgent(userId: string, id: string, input: AgentInput): Promise<SavedAgent | "not found" | "duplicate name"> {
  try {
    return toSavedAgent(await prisma.agent.update({ where: { id, userId }, data: agentData(input) }));
  } catch (error) {
    if (prismaErrorCode(error) === "P2025") {
      return "not found";
    }
    if (prismaErrorCode(error) === "P2002") {
      return "duplicate name";
    }
    throw error;
  }
}

/** True if this account had the agent and it is now gone. */
export async function deleteAgent(userId: string, id: string): Promise<boolean> {
  const { count } = await prisma.agent.deleteMany({ where: { id, userId } });
  return count > 0;
}
