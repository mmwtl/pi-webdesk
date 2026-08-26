import { describe, expect, test } from "vitest";
import { deriveSessionName } from "../../src/app/sessionName.ts";

describe("deriveSessionName", () => {
  test("uses the first sentence and removes markdown", () => {
    expect(deriveSessionName("## Add a **light theme**. Then update tests." )).toBe("Add a light theme");
  });

  test("shortens long prompts on a word boundary", () => {
    const name = deriveSessionName("Redesign the complete browser workspace interface with compact controls and improved navigation");
    expect(name.endsWith("…")).toBe(true);
    expect(name.length).toBeLessThanOrEqual(48);
  });

  test("falls back for empty prompts", () => {
    expect(deriveSessionName("   ")).toBe("New session");
  });
});
