import { describe, expect, test } from "bun:test";
import { hasNerdFont, nextTerminalFont } from "../editor-font";

const NERD = "'JetBrainsMonoNL Nerd Font'";

describe("hasNerdFont", () => {
  test("true for Nerd Font and NF families", () => {
    expect(hasNerdFont("JetBrainsMonoNL Nerd Font")).toBe(true);
    expect(hasNerdFont("Hack Nerd Font Mono")).toBe(true);
    expect(hasNerdFont("FiraCode NF")).toBe(true);
    expect(hasNerdFont("Menlo, 'hack nerd font'")).toBe(true);
  });
  test("false otherwise", () => {
    expect(hasNerdFont("Fira Code, Menlo")).toBe(false);
  });
});

describe("nextTerminalFont", () => {
  test("appends to a set font", () => {
    expect(nextTerminalFont({ terminal: "Fira Code", editor: undefined, lastWritten: undefined })).toEqual({
      action: "write",
      value: `Fira Code, ${NERD}`,
      reason: "appended",
    });
  });
  test("seeds from the editor font", () => {
    expect(nextTerminalFont({ terminal: undefined, editor: "SF Mono", lastWritten: undefined })).toEqual({
      action: "write",
      value: `SF Mono, ${NERD}`,
      reason: "seeded",
    });
  });
  test("seeds from the editor default", () => {
    expect(nextTerminalFont({ terminal: undefined, editor: undefined, lastWritten: undefined })).toEqual({
      action: "write",
      value: `Menlo, Monaco, 'Courier New', monospace, ${NERD}`,
      reason: "seeded",
    });
  });
  test("keeps a font that already has a Nerd Font", () => {
    expect(nextTerminalFont({ terminal: "Hack Nerd Font", editor: undefined, lastWritten: undefined })).toEqual({
      action: "keep",
      reason: "has-nerd",
    });
  });
  test("keeps when the member changed what rt wrote", () => {
    expect(nextTerminalFont({ terminal: "Fira Code", editor: undefined, lastWritten: `Menlo, ${NERD}` })).toEqual({
      action: "keep",
      reason: "member-undid",
    });
  });
  test("keeps when the member deleted the key rt wrote", () => {
    expect(nextTerminalFont({ terminal: undefined, editor: "SF Mono", lastWritten: `Menlo, ${NERD}` })).toEqual({
      action: "keep",
      reason: "member-undid",
    });
  });
  test("keeps the value rt wrote", () => {
    const written = `Menlo, ${NERD}`;
    expect(nextTerminalFont({ terminal: written, editor: undefined, lastWritten: written })).toEqual({
      action: "keep",
      reason: "has-nerd",
    });
  });
});
