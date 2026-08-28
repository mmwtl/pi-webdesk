import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { getRuntimeConfig } from "./config.js";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
}

function keyOrConfigured(key?: Buffer): Buffer {
  const encryptionKey = key ?? getRuntimeConfig().encryptionKey;
  if (encryptionKey.length !== 32) throw new Error("AES-256-GCM requires a 32-byte encryption key");
  return encryptionKey;
}

export function encryptApiKey(value: string, key?: Buffer): EncryptedSecret {
  if (typeof value !== "string" || !value.trim()) throw new Error("Provider API key must not be empty");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyOrConfigured(key), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptApiKey(secret: EncryptedSecret, key?: Buffer): string {
  try {
    const iv = Buffer.from(secret.iv, "base64");
    const ciphertext = Buffer.from(secret.ciphertext, "base64");
    const authTag = Buffer.from(secret.authTag, "base64");
    if (iv.length !== IV_BYTES || authTag.length !== 16) throw new Error("Invalid encrypted secret");
    const decipher = createDecipheriv(ALGORITHM, keyOrConfigured(key), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Could not decrypt provider API key");
  }
}
