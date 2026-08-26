import ignore from "ignore";

export const excludedDirectories = new Set([".git", "node_modules", "dist", "build", ".next", "coverage", ".cache"]);

export function createIgnoreMatcher(gitignore = "") {
  const matcher = ignore();
  if (gitignore) matcher.add(gitignore);
  return matcher;
}

export function isExcludedPath(path: string, matcher: ReturnType<typeof createIgnoreMatcher>): boolean {
  return path.split("/").some((part) => excludedDirectories.has(part)) || matcher.ignores(path) || matcher.ignores(`${path}/`);
}
