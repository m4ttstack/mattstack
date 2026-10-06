import { useState } from "react";
import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { POPOVER_PARTS, Popover } from "./Popover.tsx";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button">outside</button>
      <Popover
        open={open}
        onOpenChange={setOpen}
        ariaLabel="Asks"
        align="end"
        sideOffset={6}
        trigger={<button type="button">inbox</button>}
      >
        <p>Asks for your agent</p>
      </Popover>
    </>
  );
}

describe("Popover (browser)", () => {
  it("opens below its trigger, closes on Escape and on an outside click", async () => {
    await renderWithTheme(<Harness />);
    await userEvent.click(page.getByRole("button", { name: "inbox" }));
    await expect.element(page.getByRole("dialog", { name: "Asks" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog", { name: "Asks" })).not.toBeInTheDocument();
    await userEvent.click(page.getByRole("button", { name: "inbox" }));
    await expect.element(page.getByRole("dialog", { name: "Asks" })).toBeInTheDocument();
    await userEvent.click(page.getByRole("button", { name: "outside" }));
    await expect.element(page.getByRole("dialog", { name: "Asks" })).not.toBeInTheDocument();
  });

  it("stamps its parts for app CSS", async () => {
    await renderWithTheme(
      <Popover open onOpenChange={() => {}} ariaLabel="Asks" trigger={<button type="button">t</button>}>
        <p>x</p>
      </Popover>,
    );
    for (const part of Object.values(POPOVER_PARTS)) {
      expect(document.querySelector(`[data-part="${part}"]`)).not.toBeNull();
    }
  });
});
