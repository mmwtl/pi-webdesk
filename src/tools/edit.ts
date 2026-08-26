import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { WorkspaceAccessMode } from "../app/state.ts";
import { BrowserWorkspace } from "../filesystem/BrowserWorkspace.ts";
import { simpleDiff } from "../filesystem/text.ts";
import { ensureWriteAccess, result, type WriteConfirmation } from "./common.ts";

const parameters = Type.Object({ path: Type.String(), oldText: Type.String(), newText: Type.String() });
export function createEditTool(workspace: BrowserWorkspace, accessMode: WorkspaceAccessMode = "write", confirmWrite?: WriteConfirmation): AgentTool<typeof parameters> {
  return { name: "edit", label: "Edit", description: "Replace exactly one occurrence in a UTF-8 text file.", parameters, executionMode: "sequential", async execute(_id, args) {
    if (!args.oldText) throw new Error("oldText must not be empty");
    const before = (await workspace.readText(args.path)).text;
    const first = before.indexOf(args.oldText);
    const last = before.lastIndexOf(args.oldText);
    if (first < 0) throw new Error("oldText was not found; file was not changed");
    if (first !== last) throw new Error("oldText matched more than once; file was not changed");
    const after = before.slice(0, first) + args.newText + before.slice(first + args.oldText.length);
    await ensureWriteAccess(accessMode, confirmWrite, { operation: "edit", paths: [args.path] });
    await workspace.writeText(args.path, after);
    return result(`Edited ${args.path}\n\n${simpleDiff(before, after, args.path)}`, { path: args.path, replacements: 1 });
  } };
}
