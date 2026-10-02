import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { ContextMenu } from "./ContextMenu.tsx";

/**
 * Visual tier for the ContextMenu recipe.
 *
 *  * THE ANIMATION FREEZE IS INSTALLED HERE, following Chip's and ToastHost's
 * precedent: ContextMenu.keyframes.css puts a real (one-shot, not
 * perpetual) animation (contextmenu-in) on [data-part="contextmenu"], so a
 * capture mid-open would be non-deterministic between runs in BOTH opacity
 * and geometry... the keyframe
 * opens on `scale(0.97) translateY(-2px)`. `animation: none !important` is
 * what closes that; `transition: none` alone would do nothing for an
 * `animation`.
 */

const NO_MOTION_CLASS = "contextmenu-visual-no-motion";

function installNoMotionStyle() {
  if (document.getElementById(NO_MOTION_CLASS)) return;
  const style = document.createElement("style");
  style.id = NO_MOTION_CLASS;
  style.textContent = `.${NO_MOTION_CLASS}, .${NO_MOTION_CLASS} * {
    animation: none !important;
    transition: none !important;
  }`;
  document.head.appendChild(style);
}

/** Mounts into a fresh container that already carries `dark` when asked. */
async function renderFixture(ui: ReactNode, { dark = false, width = 520 } = {}) {
  await page.viewport(width, 460);
  installNoMotionStyle();

  const container = document.createElement("div");
  container.classList.add(NO_MOTION_CLASS);
  // The menu's own `position: fixed` anchors to the VIEWPORT, not this
  // container, so the container carries no positioning of its own — it exists
  // only to scope the no-motion class and hold the dark flag, whose custom
  // properties the menu still inherits through the DOM tree.
  if (dark) container.classList.add("dark");
  document.body.appendChild(container);

  const screen = await renderWithTheme(ui, { container });
  await document.fonts.ready;
  return screen;
}

/**
 * A menu shaped like the one RowMenu actually opens on an MR row: the `!iid`
 * label, pane-launching items carrying their "herdr" hint, an item with no
 * hint at all, a separator, the Slack block, one item bearing a `trailing`
 * node (mr-board's ✓ mark, whose `.tui-menu-check` class stays app-side —
 * hence the inline colour here rather than a kit slot), and one disabled item.
 * Every slot the recipe owns appears at least once.
 */
function boardMenu() {
  return (
    <ContextMenu x={20} y={20} ariaLabel="actions for !4821" onClose={() => {}}>
      <ContextMenu.Label>!4821</ContextMenu.Label>
      <ContextMenu.Item label="review" hint="herdr" onClick={() => {}} />
      <ContextMenu.Item label="focus review tab" hint="herdr" onClick={() => {}} />
      <ContextMenu.Item label="mark as draft" hint="gitlab" onClick={() => {}} />
      <ContextMenu.Item label="open in gitlab" onClick={() => {}} />
      <ContextMenu.Item label="copy for slack" onClick={() => {}} />
      <ContextMenu.Separator />
      <ContextMenu.Item
        label="unmark ✅ on slack"
        trailing={<span style={{ color: "var(--dot-ok)", fontSize: "12px" }}>✓</span>}
        onClick={() => {}}
      />
      <ContextMenu.Item label="post to slack" onClick={() => {}} />
      <ContextMenu.Item label="mark 👀 on slack" disabled onClick={() => {}} />
    </ContextMenu>
  );
}

/** The submenu paints outside the root's box, so these fixtures capture a
    fixed stage under both menus rather than the root alone. The stage is
    fixed at the viewport origin with no transform, so the menu still anchors
    to the viewport exactly as it does in the board. */
const STAGE = { width: 620, height: 200 } as const;

function Stage({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="stage"
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        width: STAGE.width,
        height: STAGE.height,
        background: "var(--bg)",
      }}
    >
      {children}
    </div>
  );
}

/** A Sub opened from the keyboard, so its panel is up and its first item
    focused, holding a row long enough to need the panel to widen. */
function subMenu() {
  return (
    <Stage>
      <ContextMenu x={20} y={20} ariaLabel="actions for !4821" onClose={() => {}}>
        <ContextMenu.Label>!4821</ContextMenu.Label>
        <ContextMenu.Item label="review" hint="herdr" onClick={() => {}} />
        <ContextMenu.Sub label="gitlab" ariaLabel="gitlab actions">
          <ContextMenu.Item label="merge" hint="pipeline running" onClick={() => {}} />
          <ContextMenu.Item
            label="ask alice's agent to re-review"
            hint="ask already sent"
            disabled
            onClick={() => {}}
          />
          <ContextMenu.Item label="open in gitlab" onClick={() => {}} />
        </ContextMenu.Sub>
        <ContextMenu.Sub label="more" ariaLabel="more actions" disabled>
          <ContextMenu.Item label="copy for slack" onClick={() => {}} />
        </ContextMenu.Sub>
      </ContextMenu>
    </Stage>
  );
}

/** The Slack reaction toggles as one Row, the middle one pressed. */
function reactionRow() {
  return (
    <Stage>
      <ContextMenu x={20} y={20} ariaLabel="actions for !4821" onClose={() => {}}>
        <ContextMenu.Label>!4821</ContextMenu.Label>
        <ContextMenu.Row aria-label="slack reactions">
          <ContextMenu.Item label="👀" aria-label="mark as looking" onClick={() => {}} />
          <ContextMenu.Item
            label="💬"
            aria-label="mark as commented"
            aria-pressed="true"
            onClick={() => {}}
          />
          <ContextMenu.Item label="✅" aria-label="mark as approved" onClick={() => {}} />
        </ContextMenu.Row>
        <ContextMenu.Separator />
        <ContextMenu.Item label="post to slack" onClick={() => {}} />
      </ContextMenu>
    </Stage>
  );
}

async function openGitlabSub() {
  const row = page.getByRole("menuitem", { name: "gitlab", exact: true });
  (row.element() as HTMLButtonElement).focus();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(page.getByRole("menuitem", { name: "merge" })).toHaveFocus();
}

describe("ContextMenu (visual)", () => {
  it("an open Sub with a long row matches its baseline in light mode", async () => {
    await renderFixture(subMenu(), { width: STAGE.width });
    await openGitlabSub();

    await expect(page.getByTestId("stage")).toMatchScreenshot("contextmenu-sub-light");
  });

  it("an open Sub with a long row matches its baseline in dark mode", async () => {
    await renderFixture(subMenu(), { dark: true, width: STAGE.width });
    await openGitlabSub();

    await expect(page.getByTestId("stage")).toMatchScreenshot("contextmenu-sub-dark");
  });

  it("a Row with one pressed toggle matches its baseline in light mode", async () => {
    await renderFixture(reactionRow(), { width: STAGE.width });

    await expect(page.getByTestId("stage")).toMatchScreenshot("contextmenu-row-light");
  });

  it("a Row with one pressed toggle matches its baseline in dark mode", async () => {
    await renderFixture(reactionRow(), { dark: true, width: STAGE.width });

    await expect(page.getByTestId("stage")).toMatchScreenshot("contextmenu-row-dark");
  });

  it("the board menu matches its baseline in light mode", async () => {
    const screen = await renderFixture(boardMenu());

    // `position: fixed` means the menu paints at the VIEWPORT's own top-left
    // rather than flowing inside `container` — a locator screenshot still
    // resolves the element's own (fixed) layout box, so this captures exactly
    // the menu, nothing more.
    await expect(
      screen.getByRole("menu", { name: "actions for !4821" }),
    ).toMatchScreenshot("contextmenu-board-light");
  });

  it("the board menu matches its baseline in dark mode", async () => {
    const screen = await renderFixture(boardMenu(), { dark: true });

    await expect(
      screen.getByRole("menu", { name: "actions for !4821" }),
    ).toMatchScreenshot("contextmenu-board-dark");
  });

  it("the hovered item's accent wash matches its baseline", async () => {
    // The one state neither still above can show: `.item:hover:not(:disabled)`
    // paints `--surface-wash-accent-16`, the same wash Segmented and SelectBox
    // use, and it is the menu's only interactive colour.
    const screen = await renderFixture(boardMenu());

    await screen.getByRole("menuitem", { name: "open in gitlab" }).hover();

    await expect(
      screen.getByRole("menu", { name: "actions for !4821" }),
    ).toMatchScreenshot("contextmenu-hover-light");
  });
});
