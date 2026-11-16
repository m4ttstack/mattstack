export const NERD_FAMILY = "JetBrainsMonoNL Nerd Font";
export const EDITOR_DEFAULT_FONT = "Menlo, Monaco, 'Courier New', monospace";

export function hasNerdFont(family: string): boolean {
  return family.split(",").some((part) => {
    const name = part.trim().replace(/^['"]+|['"]+$/g, "").trim().toLowerCase();
    return name.includes("nerd font") || name.endsWith(" nf");
  });
}

export function nextTerminalFont(input: {
  terminal: string | undefined;
  editor: string | undefined;
  lastWritten: string | undefined;
}): {
  action: "keep" | "write";
  value?: string;
  reason: "has-nerd" | "member-undid" | "appended" | "seeded";
} {
  const { lastWritten } = input;
  const terminal = input.terminal?.trim() || undefined;
  const editor = input.editor?.trim() || undefined;
  if (terminal !== undefined && hasNerdFont(terminal)) return { action: "keep", reason: "has-nerd" };
  if (lastWritten !== undefined && terminal !== lastWritten) return { action: "keep", reason: "member-undid" };
  const seeded = terminal === undefined;
  const base = (seeded ? (editor ?? EDITOR_DEFAULT_FONT) : terminal).replace(/[\s,]+$/, "");
  return { action: "write", value: `${base}, '${NERD_FAMILY}'`, reason: seeded ? "seeded" : "appended" };
}
