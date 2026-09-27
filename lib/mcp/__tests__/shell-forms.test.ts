import { describe, expect, test } from "bun:test";
import { mcpTools } from "../tools.ts";

describe("shellForms on the roster", () => {
  const tools = mcpTools();
  test("every tool declares forms or a reason it replaces none", () => {
    for (const t of tools) {
      const f = t.shellForms as unknown;
      expect(f, t.name).toBeDefined();
      if (Array.isArray(f)) expect(f.length, t.name).toBeGreaterThan(0);
      else expect(((f as { none?: string }).none ?? "").trim().length, t.name).toBeGreaterThan(0);
    }
  });
  test("every pattern form hits its own example", () => {
    for (const t of tools) {
      if (!Array.isArray(t.shellForms)) continue;
      for (const f of t.shellForms) {
        if (typeof f === "string") continue;
        expect(f.pattern.test(f.example), `${t.name} ${f.id}`).toBe(true);
      }
    }
  });
  test("every chat tool declares its rt chat verb", () => {
    for (const t of tools.filter((x) => x.name.startsWith("chat_"))) {
      const verb = `rt chat ${t.name.slice("chat_".length).replace(/_/g, "-")}`;
      const forms = Array.isArray(t.shellForms) ? t.shellForms : [];
      const declares = forms.some((f) => (typeof f === "string" ? f === verb : f.id === verb));
      expect(declares, t.name).toBe(true);
    }
  });
  test("no object form's pattern carries the g or y flag: pickRule uses exec, and a stateful regex would skip hits", () => {
    for (const t of tools) {
      if (!Array.isArray(t.shellForms)) continue;
      for (const f of t.shellForms) {
        if (typeof f === "string") continue;
        expect(f.pattern.global, `${t.name} ${f.id}`).toBe(false);
        expect(f.pattern.sticky, `${t.name} ${f.id}`).toBe(false);
      }
    }
  });
});
