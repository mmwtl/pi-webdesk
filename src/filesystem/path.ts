export function normalizeRelativePath(input = "."): string {
  const value = input.trim().replaceAll("\\", "/");
  if (!value || value === ".") return ".";
  if (value.startsWith("/") || /^[A-Za-z]:\//.test(value)) throw new Error("Path must be relative to the selected workspace");
  const parts = value.split("/").filter(Boolean);
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") throw new Error("Path escapes workspace");
    if (part.includes("\0")) throw new Error("Path contains an invalid character");
    normalized.push(part);
  }
  return normalized.join("/") || ".";
}

export function joinRelativePath(parent: string, child: string): string {
  return normalizeRelativePath(parent === "." ? child : `${parent}/${child}`);
}

export function basename(path: string): string {
  const normalized = normalizeRelativePath(path);
  return normalized === "." ? "." : normalized.split("/").at(-1)!;
}

export function dirname(path: string): string {
  const normalized = normalizeRelativePath(path);
  if (normalized === "." || !normalized.includes("/")) return ".";
  return normalized.slice(0, normalized.lastIndexOf("/"));
}

export function matchesGlob(path: string, pattern = "**/*"): boolean {
  const normalizedPath = path.replaceAll("\\", "/");
  const normalizedPattern = pattern.trim().replaceAll("\\", "/") || "**/*";
  let regex = "^";
  for (let index = 0; index < normalizedPattern.length; index++) {
    const char = normalizedPattern[index];
    if (char === "*" && normalizedPattern[index + 1] === "*") {
      index++;
      if (normalizedPattern[index + 1] === "/") { index++; regex += "(?:.*/)?"; }
      else regex += ".*";
    } else if (char === "*") regex += "[^/]*";
    else if (char === "?") regex += "[^/]";
    else regex += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${regex}$`, "i").test(normalizedPath);
}
