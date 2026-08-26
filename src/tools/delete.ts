import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { WorkspaceAccessMode } from "../app/state.ts";
import { BrowserWorkspace } from "../filesystem/BrowserWorkspace.ts";
import { ensureWriteAccess, result, type WriteConfirmation } from "./common.ts";

const parameters = Type.Object({ path: Type.String(), recursive: Type.Optional(Type.Boolean()) });
export function createDeleteTool(workspace: BrowserWorkspace, accessMode: WorkspaceAccessMode = "write", confirmWrite?: WriteConfirmation): AgentTool<typeof parameters> {
  return { name: "delete", label: "Delete", description: "Delete a file or directory inside the selected workspace. Use recursive only when explicitly needed.", parameters, executionMode: "sequential", async execute(_id, args) {
    await ensureWriteAccess(accessMode, confirmWrite, { operation: "delete", paths: [args.path] });
    await workspace.delete(args.path, args.recursive ?? false);
    return result(`Deleted ${args.path}`, { path: args.path, recursive: args.recursive ?? false });
  } };
}
