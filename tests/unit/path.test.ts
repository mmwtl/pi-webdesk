import { describe, expect, test } from "vitest";
import { basename, dirname, matchesGlob, normalizeRelativePath } from "../../src/filesystem/path.ts";

describe("browser workspace paths", () => {
  test("normalizes relative paths and rejects escape", () => {
    expect(normalizeRelativePath("src\\main.ts")).toBe("src/main.ts");
    expect(() => normalizeRelativePath("../secret")).toThrow("escapes workspace");
    expect(() => normalizeRelativePath("/absolute")).toThrow("relative");
  });

  test("matches root and nested glob paths", () => {
    expect(matchesGlob("src/main.ts", "**/*.ts")).toBe(true);
    expect(matchesGlob("README.md", "**/*.ts")).toBe(false);
    expect(matchesGlob("src/main.ts", "src/*.ts")).toBe(true);
  });

  test("returns path components", () => {
    expect(basename("src/main.ts")).toBe("main.ts");
    expect(dirname("src/main.ts")).toBe("src");
  });
});
