import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { writeFileAtomic } from "../nodeFs";

const MAX_TRUSTED = 50;

/**
 * Library folders the user picked in a native dialog (open, create, confirm),
 * persisted in the app data folder. Only these may be reopened by path
 * without a dialog, so renderer code cannot grant itself file access.
 */
export type TrustedRoots = {
  has: (root: string) => boolean;
  add: (root: string) => void;
};

export function createTrustedRoots(storePath: string): TrustedRoots {
  let roots: string[] | null = null;

  const load = (): string[] => {
    if (roots) return roots;
    roots = [];
    try {
      if (existsSync(storePath)) {
        const parsed = JSON.parse(readFileSync(storePath, "utf8")) as unknown;
        if (Array.isArray(parsed)) {
          roots = parsed.filter((p): p is string => typeof p === "string");
        }
      }
    } catch {
      // Unreadable store: start empty (recent folders ask once again).
    }
    return roots;
  };

  return {
    has: (root) => load().includes(resolve(root)),
    add: (root) => {
      const normalized = resolve(root);
      const next = [normalized, ...load().filter((p) => p !== normalized)];
      roots = next.slice(0, MAX_TRUSTED);
      try {
        writeFileAtomic(storePath, `${JSON.stringify(roots, null, 2)}\n`);
      } catch (err) {
        console.error("Could not persist trusted library folders:", err);
      }
    },
  };
}
