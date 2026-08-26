export interface BrowserEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  size: number;
}

export interface WalkEntry {
  path: string;
  kind: "file" | "directory";
  handle: FileSystemFileHandle | FileSystemDirectoryHandle;
  size: number;
}

export interface WorkspaceCapabilities {
  picker: boolean;
  read: boolean;
  write: boolean;
}
