import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { BrowserWorkspace } from "../filesystem/BrowserWorkspace.ts";
import { matchesGlob } from "../filesystem/path.ts";
import { MAX_TEXT_BYTES, clip } from "../filesystem/text.ts";
import { bounded, result } from "./common.ts";

const parameters = Type.Object({ pattern: Type.String(), path: Type.Optional(Type.String()), glob: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer()) });
export function createGrepTool(workspace: BrowserWorkspace): AgentTool<typeof parameters> {
  return { name: "grep", label: "Grep", description: "Search text files with a regular expression.", parameters, executionMode: "parallel", async execute(_id, args) {
    let regex: RegExp;
    try { regex = new RegExp(args.pattern, "i"); } catch (error) { throw new Error(`Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`); }
    const limit = bounded(args.limit, 100);
    const matches: string[] = [];
    for await (const entry of workspace.walk(args.path ?? ".")) {
      if (entry.kind !== "file" || (args.glob && !matchesGlob(entry.path, args.glob))) continue;
      if (entry.size > MAX_TEXT_BYTES) continue;
      let text: string;
      try { text = (await workspace.readText(entry.path)).text; } catch { continue; }
      text.split(/\r?\n/).forEach((line, index) => {
        if (matches.length < limit && regex.test(line)) matches.push(`${entry.path}:${index + 1}:${line}`);
      });
      if (matches.length >= limit) break;
    }
    const boundedOutput = clip(matches.join("\n"), MAX_TEXT_BYTES);
    return result(boundedOutput.value || "(no matches)", { count: matches.length, truncated: boundedOutput.truncated || matches.length >= limit });
  } };
}
