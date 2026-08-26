import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { WorkspaceAccessMode } from "../app/state.ts";
import { BrowserWorkspace } from "../filesystem/BrowserWorkspace.ts";
import { createApplyPatchTool } from "./applyPatch.ts";
import { createDeleteTool } from "./delete.ts";
import { createEditTool } from "./edit.ts";
import { createFindTool } from "./find.ts";
import { createGrepTool } from "./grep.ts";
import { createLsTool } from "./ls.ts";
import { createReadTool } from "./read.ts";
import { createWriteTool } from "./write.ts";
import type { WriteConfirmation } from "./common.ts";

export function createBrowserTools(workspace: BrowserWorkspace, accessMode: WorkspaceAccessMode = "write", confirmWrite?: WriteConfirmation): AgentTool[] {
  const readTools = [createReadTool(workspace), createLsTool(workspace), createFindTool(workspace), createGrepTool(workspace)];
  if (accessMode === "read") return readTools;
  return [...readTools, createEditTool(workspace, accessMode, confirmWrite), createWriteTool(workspace, accessMode, confirmWrite), createApplyPatchTool(workspace, accessMode, confirmWrite), createDeleteTool(workspace, accessMode, confirmWrite)];
}
