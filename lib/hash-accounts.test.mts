// Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { HASH, HASH_DOMAIN, ID_HEADER, idHeaderValue, NEW_HASH_EMAIL, cleanId, hashOf } from "./hash-accounts.ts";

test("IDs are trimmed, inner spaces collapsed, and cut to 32 characters", () => {
  assert.equal(cleanId("  Sø  🃏\t king "), "Sø 🃏 king");
  assert.equal(cleanId(undefined), "");
  assert.equal(cleanId(null), "");
  assert.equal(cleanId(42), "42");
  assert.equal(cleanId("x".repeat(40)), "x".repeat(32));
});

test("the ID travels in its header as the cleaned ID, URI-encoded", () => {
  assert.equal(ID_HEADER, "x-hash-id");
  assert.equal(idHeaderValue("  Sø  🃏 "), encodeURIComponent("Sø 🃏"));
  assert.equal(decodeURIComponent(idHeaderValue("Sø 🃏")), "Sø 🃏");
});

test("a hash account's email is its hash at the reserved domain", () => {
  const hash = "0123456789abcdef0123456789abcdef";
  assert(HASH.test(hash));
  assert(!HASH.test(hash.toUpperCase()));
  assert(!HASH.test(hash.slice(1)));
  assert.equal(NEW_HASH_EMAIL, "new@hash.invalid");
  assert.equal(hashOf(hash + HASH_DOMAIN), hash);
  assert.equal(hashOf("ann@example.com"), null);
});
