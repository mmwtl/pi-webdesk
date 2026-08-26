import { BrowserWorkspace } from "../filesystem/BrowserWorkspace.ts";
import type { WorkspaceRecord } from "../app/state.ts";
import { idbDelete, idbGet, idbGetAll, idbPut } from "./database.ts";

type StoredWorkspace = { id: string; name: string; handle: FileSystemDirectoryHandle; updatedAt: string };

function toRecord(value: StoredWorkspace, permission: PermissionState): WorkspaceRecord {
  return { ...value, permission, canWrite: permission === "granted" };
}

export async function saveWorkspace(workspace: BrowserWorkspace): Promise<WorkspaceRecord> {
  const record = { id: workspace.id, name: workspace.name, handle: workspace.handle, updatedAt: new Date().toISOString() } satisfies StoredWorkspace;
  await idbPut("workspaces", record);
  const permission = await workspace.permission();
  return toRecord(record, permission);
}

export async function restoreWorkspaces(): Promise<WorkspaceRecord[]> {
  const stored = await idbGetAll<StoredWorkspace>("workspaces");
  const records: WorkspaceRecord[] = [];
  for (const value of stored) {
    try {
      const workspace = new BrowserWorkspace(value.handle, value.id);
      records.push(toRecord(value, await workspace.permission()));
    } catch {}
  }
  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function restoreWorkspace(id: string): Promise<BrowserWorkspace | undefined> {
  const stored = await idbGet<StoredWorkspace>("workspaces", id);
  return stored ? new BrowserWorkspace(stored.handle, stored.id) : undefined;
}

export async function removeWorkspace(id: string): Promise<void> { await idbDelete("workspaces", id); }
