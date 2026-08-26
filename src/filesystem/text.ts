export const MAX_TEXT_BYTES = 128 * 1024;
export const MAX_OUTPUT_BYTES = 1024 * 1024;

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function clip(value: string, max = MAX_OUTPUT_BYTES): { value: string; truncated: boolean } {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= max) return { value, truncated: false };
  return { value: new TextDecoder().decode(bytes.slice(0, max)) + "\n[output truncated]", truncated: true };
}

export function assertText(bytes: Uint8Array): string {
  if (bytes.includes(0)) throw new Error("Binary files are not supported");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("File is not valid UTF-8 text");
  }
}

export function numberedLines(text: string, offset: number, limit: number): { body: string; nextOffset?: number } {
  const lines = text.split(/\r?\n/);
  const start = Math.max(1, offset);
  const selected = lines.slice(start - 1, start - 1 + limit);
  return {
    body: selected.map((line, index) => `${String(start + index).padStart(5, " ")} | ${line}`).join("\n"),
    ...(start - 1 + selected.length < lines.length ? { nextOffset: start + selected.length } : {}),
  };
}

export function simpleDiff(before: string, after: string, file: string): string {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  const lines = [`--- ${file}`, `+++ ${file}`];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) lines.push(`-${a[i]}`);
    if (b[i] !== undefined) lines.push(`+${b[i]}`);
  }
  return clip(lines.join("\n"), 16 * 1024).value;
}
