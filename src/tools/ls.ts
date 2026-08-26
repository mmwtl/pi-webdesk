import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { BrowserWorkspace } from "../filesystem/BrowserWorkspace.ts";
import { bounded, result } from "./common.ts";

const parameters = Type.Object({ path: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer()) });
export function createLsTool(workspace: BrowserWorkspace): AgentTool<typeof parameters> {
  return { name: "ls", label: "List", description: "List a workspace directory.", parameters, executionMode: "parallel", async execute(_id, args) {
    const rows = await workspace.list(args.path ?? ".");
    const limit = bounded(args.limit, 200);
    const selected = rows.slice(0, limit);
    return result(selected.map((row) => `${row.kind === "directory" ? "d" : "f"} ${String(row.size).padStart(10, " ")} ${row.path}`).join("\n") || "(empty)", { entries: selected, truncated: rows.length > limit });
  } };
}
