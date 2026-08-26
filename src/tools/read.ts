import type { AgentTool } from "@earendil-works/pi-agent-core";
import { BrowserWorkspace } from "../filesystem/BrowserWorkspace.ts";
import { numberedLines } from "../filesystem/text.ts";
import { bounded, result } from "./common.ts";
import { Type } from "typebox";

const parameters = Type.Object({ path: Type.String(), offset: Type.Optional(Type.Integer()), limit: Type.Optional(Type.Integer()) });
export function createReadTool(workspace: BrowserWorkspace): AgentTool<typeof parameters> {
  return { name: "read", label: "Read", description: "Read a UTF-8 text file with line numbers.", parameters, executionMode: "parallel", async execute(_id, args) {
    const file = await workspace.readText(args.path);
    const offset = bounded(args.offset, 1, 100_000);
    const limit = bounded(args.limit, 200, 1000);
    const lines = numberedLines(file.text, offset, limit);
    return result(lines.body, { path: file.path, offset, limit, nextOffset: lines.nextOffset });
  } };
}
