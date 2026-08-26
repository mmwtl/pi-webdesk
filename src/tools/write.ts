import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { WorkspaceAccessMode } from "../app/state.ts";
import { BrowserWorkspace } from "../filesystem/BrowserWorkspace.ts";
import { simpleDiff } from "../filesystem/text.ts";
import { ensureWriteAccess, result, type WriteConfirmation } from "./common.ts";

const parameters = Type.Object({ path: Type.String(), content: Type.String() });
export function createWriteTool(workspace: BrowserWorkspace, accessMode: WorkspaceAccessMode = "write", confirmWrite?: WriteConfirmation): AgentTool<typeof parameters> {
  return { name: "write", label: "Write", description: "Create or replace a UTF-8 text file in the selected workspace.", parameters, executionMode: "sequential", async execute(_id, args) {
    let before = "";
    let existed = false;
    try { before = (await workspace.readText(args.path)).text; existed = true; } catch {}
    await ensureWriteAccess(accessMode, confirmWrite, { operation: existed ? "replace a file" : "create a file", paths: [args.path] });
    const saved = await workspace.writeText(args.path, args.content);
    return result(`${existed ? "Updated" : "Created"} ${saved.path} (${saved.size} bytes)\n\n${simpleDiff(before, args.content, saved.path)}`, { path: saved.path, existed, size: saved.size });
  } };
}
