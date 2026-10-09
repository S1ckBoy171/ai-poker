// Server-only Postgres store via Prisma: table settings and API keys.
import { PrismaPg } from "@prisma/adapter-pg";
import { normalize, type Config } from "./config";
import { PrismaClient } from "./generated/prisma/client";

// One client per process; dev hot reload would otherwise open a new pool on every edit.
const g = globalThis as unknown as { prisma?: PrismaClient };
const prisma = (g.prisma ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) }));
// ponytail: keys stored in plaintext; encrypt at rest before running this anywhere shared

export async function getConfig(): Promise<Config> {
  return normalize((await prisma.settings.findUnique({ where: { id: 1 } }))?.config);
}

/** The seat's own key if it has one, else the provider key. */
export async function getAgentKey(seat: number, provider: string): Promise<string | undefined> {
  const rows = await prisma.apiKey.findMany({ where: { id: { in: [`seat:${seat}`, provider] } } });
  return (rows.find((r) => r.id === `seat:${seat}`) ?? rows[0])?.key;
}

/** Which keys are set, as masked hints - raw keys never leave the server. */
export async function keyHints(): Promise<Record<string, string>> {
  const rows = await prisma.apiKey.findMany();
  return Object.fromEntries(rows.map((r) => [r.id, `••••${r.key.slice(-4)}`]));
}

/** Save config (if given) and key edits atomically; a null key deletes it. */
export async function saveSettings(config: Config | undefined, keys: [string, string | null][]) {
  await prisma.$transaction([
    ...(config ? [prisma.settings.upsert({ where: { id: 1 }, create: { config }, update: { config } })] : []),
    ...keys.map(([id, key]) =>
      key === null ? prisma.apiKey.deleteMany({ where: { id } }) : prisma.apiKey.upsert({ where: { id }, create: { id, key }, update: { key } }),
    ),
  ]);
}
