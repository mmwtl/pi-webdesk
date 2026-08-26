import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { BrowserWorkspace } from "../filesystem/BrowserWorkspace.ts";
import { matchesGlob } from "../filesystem/path.ts";
import { bounded, result } from "./common.ts";

const parameters = Type.Object({ pattern: Type.String(), path: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer()) });
export function createFindTool(workspace: BrowserWorkspace): AgentTool<typeof parameters> {
  return { name: "find", label: "Find", description: "Find workspace paths by glob pattern.", parameters, executionMode: "parallel", async execute(_id, args) {
    const limit = bounded(args.limit, 200);
    const matches: string[] = [];
    for await (const entry of workspace.walk(args.path ?? ".")) {
      if (matchesGlob(entry.path, args.pattern) || (entry.kind === "directory" && matchesGlob(`${entry.path}/`, args.pattern))) {
        matches.push(entry.path);
        if (matches.length >= limit) break;
      }
    }
    matches.sort((a, b) => a.localeCompare(b));
    return result(matches.join("\n") || "(no matches)", { pattern: args.pattern, truncated: matches.length >= limit });
  } };
}
