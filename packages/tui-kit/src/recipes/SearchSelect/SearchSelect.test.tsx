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
    expect(document.querySelectorAll('[data-part="search-select-popup"] [class*="groupLabel"]')).toHaveLength(1);
    expect(document.body.textContent?.match(/worktrees · 2/g)).toHaveLength(1);
  });

  it("lists ungrouped items first, then groups in first-seen order", async () => {
    const mixed: SearchSelectItem[] = [
      { value: "g1", label: "alpha", group: "first group" },
      { value: "u1", label: "plain", detail: "d" },
      { value: "g2", label: "beta", group: "second group" },
      { value: "g3", label: "gamma", group: "first group" },
    ];
    await renderWithTheme(
      <SearchSelect items={mixed} value={null} onValueChange={() => {}} label="Pick" />,
    );
    await userEvent.click(page.getByRole("combobox", { name: "Pick" }));
    await expect.element(page.getByRole("option", { name: /plain/ })).toBeVisible();
    const popup = document.querySelector('[data-part="search-select-popup"]') as HTMLElement;
    const options = [...popup.querySelectorAll('[role="option"]')].map(o => o.textContent?.trim());
    expect(options).toEqual(["plaind", "alpha", "gamma", "beta"]);
    const labels = [...popup.querySelectorAll('[class*="groupLabel"]')].map(l => l.textContent);
    expect(labels).toEqual(["first group", "second group"]);
  });

  it("picks an option on click", async () => {
    const picked: string[] = [];
    function Clicky() {
      const [value, setValue] = useState<string | null>("/main");
      return (
        <SearchSelect
          items={ITEMS}
          value={value}
          onValueChange={v => {
            picked.push(v);
            setValue(v);
          }}
          label="Code to run"
        />
      );
    }
    await renderWithTheme(<Clicky />);
    await userEvent.click(page.getByRole("combobox", { name: "Code to run" }));
    await userEvent.click(page.getByRole("option", { name: /console-runs-3/ }));
    expect(picked).toEqual(["/wt/a"]);
    await expect.element(page.getByRole("combobox", { name: "Code to run" })).toHaveTextContent("console-runs-3");
  });

  it("closes on Escape and keeps the value", async () => {
    await renderWithTheme(<Harness />);
    await userEvent.click(page.getByRole("combobox", { name: "Code to run" }));
    const search = page.getByPlaceholder("Search worktrees");
    await expect.element(search).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(search).not.toBeInTheDocument();
    await expect.element(page.getByTestId("value")).toHaveTextContent("/main");
  });

  it("renders the footer after the list", async () => {
    await renderWithTheme(
      <SearchSelect items={ITEMS} value="/main" onValueChange={() => {}} label="Code to run" footer={<span>footer note</span>} />,
    );
    await userEvent.click(page.getByRole("combobox", { name: "Code to run" }));
    await expect.element(page.getByText("footer note")).toBeVisible();
    const popup = document.querySelector('[data-part="search-select-popup"]') as HTMLElement;
    const list = popup.querySelector('[role="listbox"]') as HTMLElement;
    const note = [...popup.querySelectorAll("span")].find(s => s.textContent === "footer note") as HTMLElement;
    expect(list.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
