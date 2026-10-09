// Better Auth: email + password accounts, and hash accounts (see lib/hash-accounts.ts).
import { randomBytes } from "node:crypto";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { captcha } from "better-auth/plugins";
import { prisma } from "./db";
import { HASH_DOMAIN, ID_HEADER, NEW_HASH_EMAIL, WRONG_HASH_LOGIN, cleanId } from "./hash-accounts";

const ONE_HOUR_MS = 3_600_000;
const MIN_EMAIL_PASSWORD_LENGTH = 8;

// Anyone can make a hash account without an email, so cap how many the whole server makes per hour.
// Unlike the per-address rate limit below, this can't be dodged by faking an IP address.
const HASH_ACCOUNTS_PER_HOUR = Number(process.env.HASH_ACCOUNTS_PER_HOUR) || 30;

/** The name and server-made email (its random hash) for a new hash account, within the hourly cap. */
async function newHashAccount(body: { name?: unknown }) {
  const name = cleanId(body.name);
  if (!name) {
    throw new APIError("BAD_REQUEST", { message: "Choose an ID." });
  }
  // ponytail: count-then-create, so a burst of parallel sign-ups can slip a few past the cap; use a DB counter if that matters
  const createdLastHour = await prisma.user.count({
    where: { email: { endsWith: HASH_DOMAIN }, createdAt: { gte: new Date(Date.now() - ONE_HOUR_MS) } },
  });
  if (createdLastHour >= HASH_ACCOUNTS_PER_HOUR) {
    throw new APIError("TOO_MANY_REQUESTS", { message: "Too many new hash accounts this hour. Try again later." });
  }
  return { name, email: `${randomBytes(16).toString("hex")}${HASH_DOMAIN}` };
}

/** The ID a hash sign-in sends in its header, cleaned; "" when missing or malformed (a wrong ID either way). */
function hashIdFrom(headers: Headers | undefined): string {
  try {
    return cleanId(decodeURIComponent(headers?.get(ID_HEADER) ?? ""));
  } catch {
    return "";
  }
}

// A CAPTCHA on account creation (email and hash) stops scripts from mass-creating accounts or burning the hourly cap.
const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
if (!turnstileSecret) {
  console.warn("TURNSTILE_SECRET_KEY is not set: sign-up has no CAPTCHA.");
}

export const auth = betterAuth({
  plugins: turnstileSecret ? [captcha({ provider: "cloudflare-turnstile", secretKey: turnstileSecret, endpoints: ["/sign-up/email"] })] : [],
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true, minPasswordLength: 1 }, // hash accounts take any password; email accounts need 8+ (hook below)
  // Trust the address the browser actually connected to (its Host header), so friends reaching the server by its
  // network address (npm run friends) can sign in. A page on another site can't change Host, so cross-site requests still fail.
  trustedOrigins: (request) => {
    const host = request?.headers.get("host");
    if (!request || !host) {
      return [];
    }
    return [`${new URL(request.url).protocol}//${host}`];
  },
  rateLimit: {
    enabled: true, // Better Auth only turns it on in production by default
    customRules: {
      "/sign-up/email": { window: 60, max: 3 },
      "/sign-in/email": { window: 60, max: 10 },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const email = String(ctx.body?.email ?? "")
        .trim()
        .toLowerCase();

      if (ctx.path === "/sign-up/email") {
        // The browser asks for a hash account; the server picks the hash, so nobody can choose (or reuse) one.
        if (email === NEW_HASH_EMAIL) {
          return { context: { body: { ...ctx.body, ...(await newHashAccount(ctx.body)) } } };
        }
        if (email.endsWith(HASH_DOMAIN)) {
          throw new APIError("BAD_REQUEST", { message: "That address is reserved for hash accounts." });
        }
        if (String(ctx.body?.password ?? "").length < MIN_EMAIL_PASSWORD_LENGTH) {
          throw new APIError("BAD_REQUEST", { message: "Email accounts need a password of at least 8 characters." });
        }
      }

      if (ctx.path === "/sign-in/email" && email.endsWith(HASH_DOMAIN)) {
        // A hash account signs in with all three: the hash (as the email), the password, and its ID.
        const found = await ctx.context.internalAdapter.findUserByEmail(email);
        const id = hashIdFrom(ctx.headers);
        if (!found || !id || found.user.name !== id) {
          throw new APIError("UNAUTHORIZED", { message: WRONG_HASH_LOGIN });
        }
      }
    }),
  },
});
