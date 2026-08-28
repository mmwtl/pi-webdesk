import { URL } from "node:url";

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export interface RuntimeConfig {
  databaseUrl: string;
  encryptionKey: Buffer;
}

/**
 * Parse the 32-byte key used by AES-256-GCM. Hex is the least surprising
 * format for Vercel environment variables; base64 is accepted as well.
 */
export function parseEncryptionKey(value: string | undefined): Buffer {
  const raw = value?.trim() ?? "";
  if (!raw) throw new ConfigurationError("CONFIG_ENCRYPTION_KEY is not configured");

  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");

  if (/^[A-Za-z0-9+/]{43}=$/.test(raw)) {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) return decoded;
  }

  throw new ConfigurationError("CONFIG_ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters or base64)");
}

function parseDatabaseUrl(value: string | undefined): string {
  const raw = value?.trim() ?? "";
  if (!raw) throw new ConfigurationError("DATABASE_URL is not configured");
  try {
    const url = new URL(raw);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      throw new ConfigurationError("DATABASE_URL must use postgres or postgresql");
    }
    return raw;
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError("DATABASE_URL is not a valid PostgreSQL URL");
  }
}

/** Validate infrastructure secrets lazily, so importing route modules is safe in tests. */
export function getRuntimeConfig(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  return {
    databaseUrl: parseDatabaseUrl(env.DATABASE_URL ?? env.POSTGRES_URL),
    encryptionKey: parseEncryptionKey(env.CONFIG_ENCRYPTION_KEY),
  };
}
