import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { Popover } from "./Popover.tsx";

/** Visual tier for the Popover recipe: one open popover, both schemes. */

const NO_MOTION_CLASS = "popover-visual-no-motion";

async function renderOpen(dark: boolean) {
  await page.viewport(420, 220);
  if (!document.getElementById(NO_MOTION_CLASS)) {
    const style = document.createElement("style");
    style.id = NO_MOTION_CLASS;
    style.textContent = `.${NO_MOTION_CLASS}, .${NO_MOTION_CLASS} * {
      animation: none !important;
      transition: none !important;
    }`;
    document.head.appendChild(style);
  }
  const container = document.createElement("div");
  container.classList.add(NO_MOTION_CLASS);
  if (dark) container.classList.add("dark");
  document.body.appendChild(container);

  await renderWithTheme(
    <div data-testid="stage" style={{ width: 400, height: 200, padding: 16, textAlign: "right" }}>
      <Popover
        open
        onOpenChange={() => {}}
        ariaLabel="Asks"
        align="end"
        sideOffset={6}
        trigger={<button type="button">inbox</button>}
      >
        <p style={{ margin: 8 }}>Asks for your agent</p>
      </Popover>
    </div>,
    { container },
  );
  await document.fonts.ready;
}

describe("Popover (visual)", () => {
  it("an open popover matches its baseline in light mode", async () => {
    await renderOpen(false);
    await expect(page.getByTestId("stage")).toMatchScreenshot("popover-open-light");
  });

  it("an open popover matches its baseline in dark mode", async () => {
    await renderOpen(true);
    await expect(page.getByTestId("stage")).toMatchScreenshot("popover-open-dark");
  });
});
