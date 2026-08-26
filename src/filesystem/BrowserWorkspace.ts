import { createIgnoreMatcher } from "./ignore.ts";
import { dirname, joinRelativePath, normalizeRelativePath } from "./path.ts";
import { assertText, MAX_TEXT_BYTES } from "./text.ts";
import type { BrowserEntry, WalkEntry, WorkspaceCapabilities } from "./types.ts";

export class BrowserWorkspace {
  readonly id: string;

  constructor(readonly handle: FileSystemDirectoryHandle, id: string = crypto.randomUUID() as string) {
    this.id = id;
  }

  get name(): string { return this.handle.name; }

  static async pick(): Promise<BrowserWorkspace> {
    if (!("showDirectoryPicker" in window)) throw new Error("This browser does not support selecting local folders. Use desktop Chrome or Edge 120+.");
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    const workspace = new BrowserWorkspace(handle);
    await workspace.requestPermission(true);
    return workspace;
  }

  async permission(): Promise<PermissionState> {
    if (!this.handle.queryPermission) return "granted";
    return this.handle.queryPermission({ mode: "readwrite" });
  }

  async requestPermission(write = true): Promise<PermissionState> {
    if (!this.handle.requestPermission) return "granted";
    return this.handle.requestPermission({ mode: write ? "readwrite" : "read" });
  }

  async capabilities(): Promise<WorkspaceCapabilities> {
    const permission = await this.permission();
    return { picker: "showDirectoryPicker" in window, read: permission !== "denied", write: permission === "granted" };
  }

  async resolve(path: string, kind?: "file" | "directory"): Promise<FileSystemFileHandle | FileSystemDirectoryHandle> {
    const normalized = normalizeRelativePath(path);
    let current: FileSystemDirectoryHandle = this.handle;
    if (normalized === ".") {
      if (kind === "file") throw new Error("Path is not a file");
      return current;
    }
    const parts = normalized.split("/");
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      const last = index === parts.length - 1;
      if (last && kind === "file") return current.getFileHandle(part);
      if (last && kind === "directory") return current.getDirectoryHandle(part);
      try { current = await current.getDirectoryHandle(part); } catch { throw new Error(`Directory not found: ${dirname(normalized)}`); }
    }
    return current;
  }

  async existing(path: string): Promise<FileSystemFileHandle | FileSystemDirectoryHandle> {
    const normalized = normalizeRelativePath(path);
    if (normalized === ".") return this.handle;
    try { return await this.resolve(normalized); } catch {
      try { return await this.resolve(normalized, "file"); } catch { throw new Error(`Path not found: ${normalized}`); }
    }
  }

  async ensureParent(path: string): Promise<FileSystemDirectoryHandle> {
    const normalized = normalizeRelativePath(path);
    const parts = normalized === "." ? [] : normalized.split("/");
    parts.pop();
    let current = this.handle;
    for (const part of parts) current = await current.getDirectoryHandle(part, { create: true });
    return current;
  }

  async readText(path: string): Promise<{ path: string; text: string; size: number }> {
    const normalized = normalizeRelativePath(path);
    const handle = await this.resolve(normalized, "file") as FileSystemFileHandle;
    const file = await handle.getFile();
    if (file.size > MAX_TEXT_BYTES) throw new Error("File is larger than the 128 KiB read limit");
    const text = assertText(new Uint8Array(await file.arrayBuffer()));
    return { path: normalized, text, size: file.size };
  }

  async writeText(path: string, content: string): Promise<{ path: string; existed: boolean; size: number }> {
    const normalized = normalizeRelativePath(path);
    if (normalized === ".") throw new Error("A file path is required");
    const parent = await this.ensureParent(normalized);
    const name = normalized.split("/").at(-1)!;
    let existed = false;
    try { await parent.getFileHandle(name); existed = true; } catch {}
    const file = await parent.getFileHandle(name, { create: true });
    const writable = await file.createWritable();
    try { await writable.write(content); await writable.close(); } catch (error) { await writable.abort(); throw error; }
    return { path: normalized, existed, size: new TextEncoder().encode(content).byteLength };
  }

  async delete(path: string, recursive = false): Promise<void> {
    const normalized = normalizeRelativePath(path);
    if (normalized === ".") throw new Error("The workspace root cannot be deleted");
    const parent = await this.resolve(dirname(normalized), "directory") as FileSystemDirectoryHandle;
    await parent.removeEntry(normalized.split("/").at(-1)!, { recursive });
  }

  async list(path = "."): Promise<BrowserEntry[]> {
    const directory = await this.existing(path);
    if (directory.kind !== "directory") throw new Error("Path is not a directory");
    const rows: BrowserEntry[] = [];
    for await (const entry of (directory as any).values() as AsyncIterable<FileSystemFileHandle | FileSystemDirectoryHandle>) {
      const childPath = joinRelativePath(normalizeRelativePath(path), entry.name);
      rows.push({ name: entry.name, path: childPath, kind: entry.kind, size: entry.kind === "file" ? (await entry.getFile()).size : 0 });
    }
    return rows.sort((a, b) => Number(b.kind === "directory") - Number(a.kind === "directory") || a.name.localeCompare(b.name));
  }

  async readGitignore(): Promise<string> {
    try { return (await this.readText(".gitignore")).text; } catch { return ""; }
  }

  async *walk(path = ".", includeIgnored = false): AsyncGenerator<WalkEntry> {
    const target = await this.existing(path);
    if (target.kind === "file") {
      const file = await target.getFile();
      yield { path: normalizeRelativePath(path), kind: "file", handle: target, size: file.size };
      return;
    }
    const matcher = includeIgnored ? undefined : createIgnoreMatcher(await this.readGitignore());
    yield* (await import("./traversal.ts")).walkDirectory(this.handle, target, normalizeRelativePath(path), matcher);
  }
}
