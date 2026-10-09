import { defineConfig, env } from "prisma/config";

// The Prisma CLI doesn't read .env on its own (Next.js does, for the app).
try {
  process.loadEnvFile();
} catch {}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: env("DATABASE_URL") },
});
