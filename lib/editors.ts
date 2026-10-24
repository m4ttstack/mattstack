/**
 * VS Code-family editor detection — shared by `rt settings extension`
 * (commands/extension.ts), the post-install best-effort extension install
 * (commands/post-install.ts), and the setup `tool.editor` row
 * (lib/setup/validators/tools.ts), so all three agree on which editors
 * count and where their CLI lives. Consolidated out of commands/extension.ts
 * per RULING R12 — editor detection is read from here, never re-forked.
 */

import { existsSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface DetectedEditor {
  name: string; // Display name (e.g. "Visual Studio Code")
  cliPath: string; // Full path to the CLI binary
  appPath: string; // Full path to the .app bundle
}

/**
 * Known VS Code-family editors: the .app bundle scanned for in /Applications
 * and ~/Applications, its CLI, and a fallback extensions folder under $HOME
 * (null where not known), used only when the app's own product.json names no
 * `dataFolderName`.
 */
export const EDITOR_PATTERNS: Array<{ appName: string; cliBinary: string; displayName: string; extensionsDir: string | null }> = [
  { appName: "Cursor.app", cliBinary: "cursor", displayName: "Cursor", extensionsDir: ".cursor/extensions" },
  { appName: "Cursor Personal.app", cliBinary: "cursor", displayName: "Cursor Personal", extensionsDir: null },
  { appName: "Visual Studio Code.app", cliBinary: "code", displayName: "Visual Studio Code", extensionsDir: ".vscode/extensions" },
  { appName: "Visual Studio Code - Insiders.app", cliBinary: "code-insiders", displayName: "VS Code Insiders", extensionsDir: ".vscode-insiders/extensions" },
  { appName: "VSCodium.app", cliBinary: "codium", displayName: "VSCodium", extensionsDir: ".vscode-oss/extensions" },
  { appName: "Antigravity.app", cliBinary: "antigravity", displayName: "Antigravity", extensionsDir: ".antigravity/extensions" },
  { appName: "Windsurf.app", cliBinary: "windsurf", displayName: "Windsurf", extensionsDir: ".windsurf/extensions" },
];

export type DetectedEditorWithExtensions = DetectedEditor & { extensionsDir: string | null };

/** The same scan as `detectEditors`, through an injected `exists`, so a caller holding Probes never reads the real machine in a test. */
export function detectEditorsVia(exists: (path: string) => boolean, appDirs: string[]): DetectedEditorWithExtensions[] {
  const editors: DetectedEditorWithExtensions[] = [];
  for (const appDir of appDirs) {
    for (const pattern of EDITOR_PATTERNS) {
      const appPath = join(appDir, pattern.appName);
      const cliPath = join(appPath, "Contents/Resources/app/bin", pattern.cliBinary);
      if (exists(cliPath)) editors.push({ name: pattern.displayName, cliPath, appPath, extensionsDir: pattern.extensionsDir });
    }
  }
  return editors;
}

const APP_DIRS = ["/Applications", join(homedir(), "Applications")];

/** `appDirs` defaults to the real /Applications + ~/Applications; overridable so tests can point at a fixture root instead of the reviewer's own machine. */
export function detectEditors(appDirs: string[] = APP_DIRS): DetectedEditor[] {
  const editors: DetectedEditor[] = [];

  for (const appDir of appDirs) {
    if (!existsSync(appDir)) continue;

    let apps: string[];
    try {
      apps = readdirSync(appDir);
    } catch {
      continue;
    }

    for (const pattern of EDITOR_PATTERNS) {
      if (!apps.includes(pattern.appName)) continue;

      const appPath = join(appDir, pattern.appName);
      // VS Code-family editors store CLI in Contents/Resources/app/bin/<name>
      const cliPath = join(appPath, "Contents/Resources/app/bin", pattern.cliBinary);

      if (existsSync(cliPath)) {
        editors.push({ name: pattern.displayName, cliPath, appPath });
      }
    }
  }

  return editors;
}
