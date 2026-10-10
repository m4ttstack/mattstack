import { useState } from "react";
import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { SearchSelect, type SearchSelectItem } from "./SearchSelect.tsx";

const ITEMS: SearchSelectItem[] = [
  { value: "/main", label: "main", detail: "shared checkout" },
  { value: "/wt/a", label: "console-runs-3", group: "worktrees · 2" },
  { value: "/wt/b", label: "deck-live-mode", group: "worktrees · 2", detail: "needs setup" },
];

function Harness() {
  const [value, setValue] = useState<string | null>("/main");
  return (
    <>
      <SearchSelect items={ITEMS} value={value} onValueChange={setValue} label="Code to run" searchPlaceholder="Search worktrees" />
      <output data-testid="value">{value}</output>
    </>
  );
}

describe("SearchSelect (browser)", () => {
  it("shows the picked item on its trigger", async () => {
    await renderWithTheme(<Harness />);
    await expect.element(page.getByRole("combobox", { name: "Code to run" })).toHaveTextContent("main");
  });

  it("opens with the search focused, filters, and picks with Enter", async () => {
    await renderWithTheme(<Harness />);
    await userEvent.click(page.getByRole("combobox", { name: "Code to run" }));
    const search = page.getByPlaceholder("Search worktrees");
    await expect.element(search).toHaveFocus();
    await userEvent.type(search, "deck");
    await expect.element(page.getByRole("option", { name: /console-runs-3/ })).not.toBeInTheDocument();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect.element(page.getByTestId("value")).toHaveTextContent("/wt/b");
  });

  it("labels each group once", async () => {
    await renderWithTheme(<Harness />);
    await userEvent.click(page.getByRole("combobox", { name: "Code to run" }));
    await expect.element(page.getByText("worktrees · 2")).toBeVisible();
  });
});
