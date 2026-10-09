// Hash accounts: any ID and password (repeats allowed); the server makes a random hash that identifies the account.
// The hash is stored as the account's email, <hash>@hash.invalid (.invalid is a reserved TLD, never a real mailbox).
// Shared by the login page and the server.

export const HASH_DOMAIN = "@hash.invalid";
export const NEW_HASH_EMAIL = `new${HASH_DOMAIN}`; // "make me a hash": the server swaps in a random one
export const HASH = /^[0-9a-f]{32}$/;
export const ID_HEADER = "x-hash-id"; // hash sign-in sends the ID here; it must match the account the hash points to
export const WRONG_HASH_LOGIN = "ID, password or hash is wrong.";

/** IDs are compared after the same clean-up on both sides: trimmed, inner spaces collapsed, at most 32 characters. */
export const cleanId = (id: unknown) =>
  String(id ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 32);

/** The ID as sent in its header: headers must be plain ASCII, and IDs can be anything. */
export const idHeaderValue = (id: string) => encodeURIComponent(cleanId(id));

/** The hash inside a hash account's email, or null for an email account. */
export const hashOf = (email: string) => (email.endsWith(HASH_DOMAIN) ? email.slice(0, -HASH_DOMAIN.length) : null);
