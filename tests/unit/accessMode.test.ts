import { describe, expect, test, vi } from "vitest";
import { createApplyPatchTool } from "../../src/tools/applyPatch.ts";
import { createBrowserTools } from "../../src/tools/createBrowserTools.ts";
import { ensureWriteAccess } from "../../src/tools/common.ts";
import { createDeleteTool } from "../../src/tools/delete.ts";
import { createEditTool } from "../../src/tools/edit.ts";
import { createWriteTool } from "../../src/tools/write.ts";

const workspace = {} as any;
const request = { operation: "edit", paths: ["src/app.ts"] };

describe("workspace access modes", () => {
  test("read-only blocks writes and hides mutation tools", async () => {
    await expect(ensureWriteAccess("read", undefined, request)).rejects.toThrow("read-only");
    expect(createBrowserTools(workspace, "read").map((tool) => tool.name)).toEqual(["read", "ls", "find", "grep"]);
  });

  test("every mutation tool checks read-only access before touching the workspace", async () => {
    const fakeWorkspace = {
      readText: vi.fn(async () => ({ text: "before" })),
      writeText: vi.fn(),
      delete: vi.fn(),
    } as any;
    const mutationCalls = [
      createEditTool(fakeWorkspace, "read").execute("edit-1", { path: "a.txt", oldText: "before", newText: "after" }),
      createWriteTool(fakeWorkspace, "read").execute("write-1", { path: "a.txt", content: "after" }),
      createDeleteTool(fakeWorkspace, "read").execute("delete-1", { path: "a.txt" }),
      createApplyPatchTool(fakeWorkspace, "read").execute("patch-1", { patch: "*** Update File: a.txt\n@@\n-before\n+after\n*** End Patch" }),
    ];
    await expect(Promise.all(mutationCalls)).rejects.toThrow("read-only");
    expect(fakeWorkspace.writeText).not.toHaveBeenCalled();
    expect(fakeWorkspace.delete).not.toHaveBeenCalled();
  });

  test("confirmation mode delegates the decision and blocks a denial", async () => {
    const confirm = vi.fn(() => false);
    await expect(ensureWriteAccess("confirm", confirm, request)).rejects.toThrow("cancelled");
    expect(confirm).toHaveBeenCalledWith(request);
    await expect(ensureWriteAccess("confirm", () => true, request)).resolves.toBeUndefined();
  });

  test("direct write mode does not ask and exposes mutation tools", async () => {
    const confirm = vi.fn(() => false);
    await expect(ensureWriteAccess("write", confirm, request)).resolves.toBeUndefined();
    expect(confirm).not.toHaveBeenCalled();
    expect(createBrowserTools(workspace, "write")).toHaveLength(8);
  });
});
