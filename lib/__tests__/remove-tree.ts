import { chmodSync, lstatSync, readdirSync, rmSync } from "fs";
import { join } from "path";

type Remove = (path: string) => void;
const rmTree: Remove = (path) => rmSync(path, { recursive: true, force: true });

// The preload's sweep and a dead run's own detached rm can remove the same
// tree at once; an ENOENT means the other remover got there first, and what
// is left is theirs to finish.
export function removeTree(path: string, remove: Remove = rmTree): void {
  try {
    remove(path);
  } catch (err) {
    if (isVanished(err)) return;
    makeDirsWritable(path);
    try {
      remove(path);
    } catch (err) {
      if (!isVanished(err)) throw err;
    }
  }
}

function makeDirsWritable(path: string): void {
  try {
    if (!lstatSync(path).isDirectory()) return;
    chmodSync(path, 0o700);
    for (const name of readdirSync(path)) makeDirsWritable(join(path, name));
  } catch (err) {
    if (!isVanished(err)) throw err;
  }
}

function isVanished(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}
