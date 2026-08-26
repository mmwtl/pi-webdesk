import type { SessionRecord, SessionSummary } from "../app/state.ts";
import { idbDelete, idbGet, idbGetAll, idbPut } from "./database.ts";

export async function listSessions(workspaceId: string): Promise<SessionSummary[]> {
  const sessions = await idbGetAll<SessionRecord>("sessions", "workspaceId", workspaceId);
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(({ id, workspaceId: owner, name, createdAt, updatedAt, baseUrl, modelId, titleMode }) => ({ id, workspaceId: owner, name, createdAt, updatedAt, baseUrl, modelId, titleMode }));
}

export async function loadSession(id: string): Promise<SessionRecord | undefined> { return idbGet<SessionRecord>("sessions", id); }

export async function createSession(workspaceId: string, baseUrl: string, modelId: string, name = "New session"): Promise<SessionSummary> {
  const now = new Date().toISOString();
  const record: SessionRecord = { id: crypto.randomUUID(), workspaceId, name, createdAt: now, updatedAt: now, baseUrl, modelId, titleMode: "auto", systemPromptHash: "", messages: [] };
  await idbPut("sessions", record);
  return record;
}

export async function saveSession(session: SessionRecord): Promise<SessionSummary> {
  const record = { ...session, updatedAt: new Date().toISOString() };
  await idbPut("sessions", record);
  const { id, workspaceId, name, createdAt, updatedAt, baseUrl, modelId, titleMode } = record;
  return { id, workspaceId, name, createdAt, updatedAt, baseUrl, modelId, titleMode };
}

export async function renameSession(id: string, name: string, titleMode: "auto" | "manual"): Promise<SessionSummary> {
  const existing = await loadSession(id);
  if (!existing) throw new Error("Session no longer exists");
  const record: SessionRecord = { ...existing, name, titleMode };
  await idbPut("sessions", record);
  const { workspaceId, createdAt, updatedAt, baseUrl, modelId } = record;
  return { id, workspaceId, name, createdAt, updatedAt, baseUrl, modelId, titleMode };
}

export async function deleteSession(id: string): Promise<void> { await idbDelete("sessions", id); }
