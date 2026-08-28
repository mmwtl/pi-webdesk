import { describe, expect, test } from "vitest";

import { decryptApiKey, encryptApiKey } from "../../api/_lib/crypto.ts";
import { parseEncryptionKey } from "../../api/_lib/config.ts";
import { SCHEMA_SQL } from "../../api/_lib/database.ts";

const KEY = Buffer.from("11".repeat(32), "hex");

describe("provider key encryption", () => {
  test("round-trips an API key with AES-256-GCM", () => {
    const encrypted = encryptApiKey("sk-test-secret", KEY);

    expect(encrypted.ciphertext).not.toContain("sk-test-secret");
    expect(decryptApiKey(encrypted, KEY)).toBe("sk-test-secret");
  });

  test("rejects a modified encrypted key", () => {
    const encrypted = encryptApiKey("sk-test-secret", KEY);

    expect(() => decryptApiKey({ ...encrypted, authTag: "00" }, KEY)).toThrow("Could not decrypt provider API key");
  });

  test("accepts only a 32-byte encryption key", () => {
    expect(parseEncryptionKey("22".repeat(32))).toEqual(Buffer.from("22".repeat(32), "hex"));
    expect(() => parseEncryptionKey("too-short")).toThrow("CONFIG_ENCRYPTION_KEY");
  });

  test("serializes concurrent serverless schema initialization", () => {
    expect(SCHEMA_SQL).toContain("pg_advisory_xact_lock");
    expect(SCHEMA_SQL).toContain("DO $pi_webdesk_schema$");
  });
});
