import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { WorkspaceAccessMode, WorkspaceWriteRequest } from "../app/state.ts";
import { clip as clipText } from "../filesystem/text.ts";

export type WriteConfirmation = (request: WorkspaceWriteRequest) => Promise<boolean> | boolean;

export function result(text: string, details: Record<string, unknown> = {}): AgentToolResult<Record<string, unknown>> {
  return { content: [{ type: "text", text }], details };
}

export function clip(value: string, max?: number): { value: string; truncated: boolean } {
  return clipText(value, max);
}

export function bounded(value: unknown, fallback: number, max = 1000): number {
  const number = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(1, number));
}

export async function ensureWriteAccess(mode: WorkspaceAccessMode, confirmWrite: WriteConfirmation | undefined, request: WorkspaceWriteRequest): Promise<void> {
  if (mode === "read") {
    throw new Error("Workspace is read-only. Choose Write with confirmation or Write directly from the workspace access menu.");
  }
  if (mode === "confirm" && (!confirmWrite || !(await confirmWrite(request)))) {
    throw new Error("Write cancelled by user.");
  }
}
