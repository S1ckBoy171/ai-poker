// Server-only Postgres store via Prisma. Settings, API keys and hands belong to one account (userId) each.
import { PrismaPg } from "@prisma/adapter-pg";
import { normalize, type Config } from "./config";
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
