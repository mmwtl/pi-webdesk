import { isExcludedPath } from "./ignore.ts";
import { joinRelativePath } from "./path.ts";
import type { WalkEntry } from "./types.ts";

export async function* walkDirectory(
  root: FileSystemDirectoryHandle,
  directory: FileSystemDirectoryHandle = root,
  relative = ".",
  matcher?: { ignores(path: string): boolean },
): AsyncGenerator<WalkEntry> {
  for await (const entry of (directory as any).values() as AsyncIterable<FileSystemFileHandle | FileSystemDirectoryHandle>) {
    const path = joinRelativePath(relative, entry.name);
    if (matcher && isExcludedPath(path, matcher as never)) continue;
    if (entry.kind === "directory") {
      yield { path, kind: "directory", handle: entry, size: 0 };
      yield* walkDirectory(root, entry, path, matcher);
    } else {
      const file = await entry.getFile();
      yield { path, kind: "file", handle: entry, size: file.size };
    }
  }
}
