import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { WorkspaceAccessMode } from "../app/state.ts";
import { BrowserWorkspace } from "../filesystem/BrowserWorkspace.ts";
import { simpleDiff } from "../filesystem/text.ts";
import { ensureWriteAccess, result, type WriteConfirmation } from "./common.ts";

const parameters = Type.Object({ patch: Type.String() });
type Hunk = { oldLines: string[]; newLines: string[] };

function parsePatch(patch: string): Array<{ path: string; hunks: Hunk[] }> {
  const lines = patch.replaceAll("\r\n", "\n").split("\n");
  const files: Array<{ path: string; hunks: Hunk[] }> = [];
  let current: { path: string; hunks: Hunk[] } | undefined;
  let hunk: Hunk | undefined;
  for (const line of lines) {
    if (line.startsWith("*** Update File: ")) {
      current = { path: line.slice(17).trim(), hunks: [] }; files.push(current); hunk = undefined;
    } else if (line.startsWith("*** Add File: ")) {
      current = { path: line.slice(15).trim(), hunks: [{ oldLines: [], newLines: [] }] }; files.push(current); hunk = current.hunks[0];
    } else if (line.startsWith("*** Delete File: ")) {
      current = { path: line.slice(18).trim(), hunks: [{ oldLines: [], newLines: [] }] }; files.push(current); hunk = current.hunks[0];
    } else if (line.startsWith("@@")) {
      if (!current) throw new Error("Patch contains a hunk before a file header");
      hunk = { oldLines: [], newLines: [] }; current.hunks.push(hunk);
    } else if (hunk && line !== "*** End Patch" && line !== "") {
      const marker = line[0];
      if (marker === " ") { hunk.oldLines.push(line.slice(1)); hunk.newLines.push(line.slice(1)); }
      else if (marker === "-") hunk.oldLines.push(line.slice(1));
      else if (marker === "+") hunk.newLines.push(line.slice(1));
      else if (!line.startsWith("***")) throw new Error(`Unsupported patch line: ${line}`);
    }
  }
  if (!files.length) throw new Error("Patch did not contain a file header");
  return files;
}

function applyHunks(before: string, hunks: Hunk[]): string {
  let output = before;
  for (const hunk of hunks) {
    if (!hunk.oldLines.length && hunk.newLines.length) output = hunk.newLines.join("\n") + "\n";
    else {
      const oldText = hunk.oldLines.join("\n");
      const newText = hunk.newLines.join("\n");
      const index = output.indexOf(oldText);
      if (index < 0) throw new Error("Patch context did not match the current file");
      if (output.indexOf(oldText, index + 1) >= 0) throw new Error("Patch context matched more than once");
      output = output.slice(0, index) + newText + output.slice(index + oldText.length);
    }
  }
  return output;
}

export function createApplyPatchTool(workspace: BrowserWorkspace, accessMode: WorkspaceAccessMode = "write", confirmWrite?: WriteConfirmation): AgentTool<typeof parameters> {
  return { name: "apply_patch", label: "Patch", description: "Apply a focused multi-file patch using Update/Add/Delete File sections.", parameters, executionMode: "sequential", async execute(_id, args) {
    const files = parsePatch(args.patch);
    await ensureWriteAccess(accessMode, confirmWrite, { operation: "apply a patch", paths: files.map((file) => file.path) });
    const changes: string[] = [];
    for (const file of files) {
      const isDelete = args.patch.includes(`*** Delete File: ${file.path}`);
      if (isDelete) { await workspace.delete(file.path); changes.push(`Deleted ${file.path}`); continue; }
      let before = "";
      try { before = (await workspace.readText(file.path)).text; } catch {}
      const after = applyHunks(before, file.hunks);
      await workspace.writeText(file.path, after);
      changes.push(`${before ? "Updated" : "Created"} ${file.path}\n${simpleDiff(before, after, file.path)}`);
    }
    return result(changes.join("\n\n"), { files: changes.length });
  } };
}
