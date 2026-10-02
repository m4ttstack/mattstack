import { contrastRatio } from "@mattstack/tokens/color-math";
import { createTheme } from "@soribashi/core";
import { useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { animationResolution } from "../../../test/keyframes.ts";
import { tuiTheme } from "../../theme.ts";
import { SideDrawer } from "../SideDrawer/SideDrawer.tsx";
import { CONTEXTMENU_PARTS, ContextMenu } from "./ContextMenu.tsx";

/**
 * Browser tier for the ContextMenu recipe — the kit's ONLY `defineCompound`.
 *
 * Each render goes through
 * `renderWithTheme`; assertions observe rendered behaviour, never emitted CSS
 * text; the one sanctioned structural assertion is
 * `data-part`.
 *
 * FOUR MECHANICS ARE SPECIFIC TO A CURSOR-ANCHORED MENU and each has a
 * wrong-looking-but-correct shape, so they are spelled out once here:
 *
 *  1. THE CLAMP IS ASSERTED AS REAL GEOMETRY, not as the `left`/`top` inline
 *     style strings. `getBoundingClientRect()` is what the user sees; the
 *     inline style is an implementation detail that happens to agree today.
 *     The requested point is deliberately pushed FAR outside the viewport
 *     (`innerWidth + 400`) so a recipe that forgot to clamp would fail by a
 *     mile rather than by a rounding error.
 *  2. DISMISSAL EVENTS ARE DISPATCHED, NOT DRIVEN. `mousedown` on `<body>`,
 *     `scroll`/`resize` on `window`: a driver click resolves an element's
 *     centre, and the menu is `position: fixed` over exactly that region, so
 *     `userEvent.click(document.body)` would land ON the menu and prove the
 *     opposite of what it claims. Escape is the exception — it goes through
 *     `userEvent.keyboard`, a real key event to the focused element, which
 *     bubbles to the `document` listener `useEscapeClose` installs.
 *  3. A DISABLED ITEM IS CLICKED PROGRAMMATICALLY (`el.click()`). Playwright's
 *     actionability check makes a driver click on a disabled control hang
 *     until it times out; `HTMLElement.click()` on a disabled form control is
 *     a defined no-op (the activation behaviour returns early), which is
 *     exactly the browser behaviour the `disabled` prop is claiming.
 *  4. THE LAYER STACK IS MODULE-GLOBAL (src/hooks/layers.ts).
 *     vitest-browser-react's per-test cleanup unmounts every tree, which pops
 *     the registration, so no test resets it by hand.
 */

const noop = () => {};

function rootOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-part="${CONTEXTMENU_PARTS.root}"]`);
  if (!el) throw new Error("no context menu rendered");
  return el;
}

/** Every element in this render carrying `data-part="<part>"`. Scoped to the
    render's own container, never `document`, so a leaked tree from a previous
    test can never make one of these rows pass or fail by accident. */
function partsIn(container: HTMLElement, part: string): NodeListOf<HTMLElement> {
  return container.querySelectorAll<HTMLElement>(`[data-part="${part}"]`);
}

/** A computed `rgb(...)` colour as the hex `contrastRatio` reads. Opaque
    colours only: an alpha channel is dropped, not composited. */
function toHex(rgb: string): string {
  const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  return `#${[r, g, b].map((c) => Math.round(c ?? 0).toString(16).padStart(2, "0")).join("")}`;
}

/** The viewport margin the recipe clamps to, as a literal — reading it out of
    the recipe would make every clamp assertion below vacuous. */
const MARGIN = 8;

/**
 * The element's box AFTER its entry animation has finished.
 *
 * This is load-bearing, not defensive. `contextmenu-in` opens on
 * `scale(0.97) translateY(-2px)`, and `getBoundingClientRect()` reports the
 * TRANSFORMED box — so a rect read while the animation is in flight is ~3%
 * narrow and 3px off, and `getComputedStyle(...).opacity` reads the
 * animation's `0`, not the element's own value. Waiting for
 * `Animation.finished` makes every geometry row below assert the box the user
 * ends up looking at, which is also what makes them able to fail: the recipe
 * measures with `offsetWidth`/`offsetHeight` precisely so the SETTLED box fits
 * inside the margin, and a `getBoundingClientRect()` measure (mr-board's own)
 * overhangs it by ~6px and fails here.
 */
async function settledBox(el: HTMLElement): Promise<DOMRect> {
  await Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined)));
  return el.getBoundingClientRect();
}

describe("ContextMenu (browser)", () => {
  it("renders a labelled menu whose items are menuitems", async () => {
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="actions for !42" onClose={noop}>
        <ContextMenu.Label>!42</ContextMenu.Label>
        <ContextMenu.Item label="open in gitlab" onClick={noop} />
        <ContextMenu.Item label="copy for slack" onClick={noop} />
      </ContextMenu>,
    );

    await expect.element(screen.getByRole("menu", { name: "actions for !42" })).toBeVisible();
    await expect.element(screen.getByRole("menuitem", { name: "open in gitlab" })).toBeVisible();
    expect(screen.container.textContent).toContain("!42");
  });

  it("opens via a @keyframes rule a loaded sheet actually declares, under its global name", async () => {
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop}>
        <ContextMenu.Item label="open in gitlab" onClick={noop} />
      </ContextMenu>,
    );

    // `animation-name` is a static computed value: it still reads the ident
    // after the 90ms entry animation has finished, so no settle wait here.
    const { name, found } = animationResolution(rootOf(screen.container));
    expect(found, `no @keyframes rule named "${name}" in any loaded sheet`).toBe(true);
    expect(name).toBe("contextmenu-in");
  });

  it("adds no height to the page it opens in (a grid parent's row gap is not fed by the menu's guards)", async () => {
    const screen = await renderWithTheme(
      <div data-testid="host" style={{ display: "grid", rowGap: 20 }}>
        <div style={{ height: 100 }} />
        <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop}>
          <ContextMenu.Item label="one" onClick={noop} />
        </ContextMenu>
      </div>,
    );
    await expect.element(screen.getByRole("menu")).toBeVisible();
    const host = screen.container.querySelector<HTMLElement>('[data-testid="host"]')!;
    expect(host.getBoundingClientRect().height).toBe(100);
  });

  it("an item fires its onClick, and does NOT close the menu by itself", async () => {
    // mr-board's Slack-mark items stay open so several marks can be set in one
    // visit; closing is the CALLER's decision (RowMenu's own `run()` helper).
    const onClick = vi.fn();
    const onClose = vi.fn();
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={onClose}>
        <ContextMenu.Item label="mark reviewed on slack" onClick={onClick} />
      </ContextMenu>,
    );

    await screen.getByRole("menuitem", { name: "mark reviewed on slack" }).click();

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("when an item's onClick moves focus elsewhere, focus stays there", async () => {
    // The board's scheme menu sends focus back to its trigger on a pick.
    function Harness() {
      const triggerRef = useRef<HTMLButtonElement | null>(null);
      const [open, setOpen] = useState(true);
      return (
        <>
          <button ref={triggerRef} type="button">
            scheme
          </button>
          {open && (
            <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop}>
              <ContextMenu.Item
                label="dark"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              />
            </ContextMenu>
          )}
        </>
      );
    }
    const screen = await renderWithTheme(<Harness />);
    await settledBox(rootOf(screen.container));

    await screen.getByRole("menuitem", { name: "dark" }).click();

    await expect.element(screen.getByRole("button", { name: "scheme" })).toHaveFocus();
  });

  it("a disabled item is disabled in the DOM and does not fire", async () => {
    const onClick = vi.fn();
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop}>
        <ContextMenu.Item label="mark reviewed on slack" disabled onClick={onClick} />
      </ContextMenu>,
    );

    const item = rootOf(screen.container).querySelector<HTMLButtonElement>("button") as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    item.click();

    expect(onClick).not.toHaveBeenCalled();
  });

  it("a disabled item still shows its hint, and the arrow keys skip it", async () => {
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop}>
        <ContextMenu.Item label="review" onClick={noop} />
        <ContextMenu.Item label="merge" hint="pipeline running" disabled onClick={noop} />
        <ContextMenu.Item label="open in gitlab" onClick={noop} />
      </ContextMenu>,
    );
    expect(partsIn(screen.container, CONTEXTMENU_PARTS.hint)[0]?.textContent).toBe("pipeline running");
    const root = rootOf(screen.container);
    await expect.poll(() => root.contains(document.activeElement)).toBe(true);

    await userEvent.keyboard("{ArrowDown}");
    await expect.element(screen.getByRole("menuitem", { name: "review" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(screen.getByRole("menuitem", { name: "open in gitlab" })).toHaveFocus();
  });

  it.each([
    ["light", false],
    ["dark", true],
  ])(
    "a disabled item reads as unavailable in %s mode: a dim label, a legible italic hint, not-allowed, never washed",
    async (_scheme, dark) => {
      const container = document.createElement("div");
      if (dark) container.classList.add("dark");
      document.body.appendChild(container);
      const screen = await renderWithTheme(
        <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop}>
          <ContextMenu.Item label="review" onClick={noop} />
          <ContextMenu.Item label="merge" hint="needs approval" disabled onClick={noop} />
          <ContextMenu.Sub label="gitlab" ariaLabel="gitlab actions" disabled>
            <ContextMenu.Item label="rebase" onClick={noop} />
          </ContextMenu.Sub>
        </ContextMenu>,
        { container },
      );
      const root = rootOf(screen.container);
      const item = screen.getByRole("menuitem", { name: "merge" }).element() as HTMLButtonElement;
      const hint = partsIn(screen.container, CONTEXTMENU_PARTS.hint)[0] as HTMLElement;
      const live = screen.getByRole("menuitem", { name: "review" }).element();
      const sub = screen.getByRole("menuitem", { name: "gitlab", exact: true }).element();
      const card = toHex(getComputedStyle(root).backgroundColor);
      const blockedInk = toHex(getComputedStyle(item).color);
      const liveInk = toHex(getComputedStyle(live).color);
      const label = contrastRatio(blockedInk, card);

      expect(getComputedStyle(item).opacity).toBe("1");
      expect(getComputedStyle(item).cursor).toBe("not-allowed");
      expect(label).toBeGreaterThanOrEqual(3);
      expect(label).toBeLessThan(4.5);
      expect(contrastRatio(blockedInk, liveInk)).toBeGreaterThanOrEqual(2);
      expect(contrastRatio(toHex(getComputedStyle(hint).color), card)).toBeGreaterThanOrEqual(4.5);
      expect(getComputedStyle(hint).fontStyle).toBe("italic");
      expect(toHex(getComputedStyle(sub).color)).toBe(blockedInk);

      const idle = getComputedStyle(item).backgroundColor;
      await screen.getByRole("menuitem", { name: "merge" }).hover();
      expect(getComputedStyle(item).backgroundColor).toBe(idle);
      container.remove();
    },
  );

  it("renders `hint` as its own slot, and lets `trailing` replace it", async () => {
    // RowMenu's two item shapes: a plain right-hand hint ("herdr", "gitlab",
    // "peer"), and an arbitrary trailing node (the ✓ mark / the spinner).
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop}>
        <ContextMenu.Item label="review" hint="herdr" onClick={noop} />
        <ContextMenu.Item
          label="unmark ✅ on slack"
          hint="ignored"
          trailing={<span data-testid="check">✓</span>}
          onClick={noop}
        />
      </ContextMenu>,
    );

    const hints = partsIn(screen.container, CONTEXTMENU_PARTS.hint);
    expect(hints).toHaveLength(1);
    expect(hints[0]?.textContent).toBe("herdr");
    expect(screen.container.textContent).not.toContain("ignored");
    await expect.element(screen.getByTestId("check")).toBeVisible();
  });

  it("clamps a point beyond the right/bottom edge back inside the viewport", async () => {
    const screen = await renderWithTheme(
      <ContextMenu
        x={window.innerWidth + 400}
        y={window.innerHeight + 400}
        ariaLabel="m"
        onClose={noop}
      >
        <ContextMenu.Item label="open in gitlab" onClick={noop} />
        <ContextMenu.Item label="copy for slack" onClick={noop} />
      </ContextMenu>,
    );

    const box = await settledBox(rootOf(screen.container));
    expect(box.left).toBeLessThanOrEqual(window.innerWidth - MARGIN);
    expect(box.top).toBeLessThanOrEqual(window.innerHeight - MARGIN);
    // The whole box, not just its origin, is what has to fit.
    expect(box.right).toBeLessThanOrEqual(window.innerWidth - MARGIN + 0.5);
    expect(box.bottom).toBeLessThanOrEqual(window.innerHeight - MARGIN + 0.5);
  });

  it("clamps a negative point to the near edge's own margin", async () => {
    const screen = await renderWithTheme(
      <ContextMenu x={-500} y={-500} ariaLabel="m" onClose={noop}>
        <ContextMenu.Item label="open in gitlab" onClick={noop} />
      </ContextMenu>,
    );

    const box = await settledBox(rootOf(screen.container));
    expect(Math.abs(box.left - MARGIN)).toBeLessThan(0.5);
    expect(Math.abs(box.top - MARGIN)).toBeLessThan(0.5);
  });

  it("is hidden until it has been measured, then visible at the clamped point", async () => {
    // The `visibility: hidden` first paint is what stops the menu flashing at
    // the un-clamped point; by the time the render promise resolves the layout
    // effect has run, so the settled state is what is observable here.
    const screen = await renderWithTheme(
      <ContextMenu x={30} y={30} ariaLabel="m" onClose={noop}>
        <ContextMenu.Item label="open in gitlab" onClick={noop} />
      </ContextMenu>,
    );

    const root = rootOf(screen.container);
    expect(getComputedStyle(root).visibility).toBe("visible");
    const box = await settledBox(root);
    expect(Math.abs(box.left - 30)).toBeLessThan(0.5);
    expect(Math.abs(box.top - 30)).toBeLessThan(0.5);
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={onClose}>
        <ContextMenu.Item label="open in gitlab" onClick={noop} />
      </ContextMenu>,
    );

    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape pressed on one of its own items", async () => {
    const onClose = vi.fn();
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={onClose}>
        <ContextMenu.Item label="open in gitlab" onClick={noop} />
      </ContextMenu>,
    );
    (screen.getByRole("menuitem", { name: "open in gitlab" }).element() as HTMLElement).focus();

    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a mousedown OUTSIDE it, but not on one inside", async () => {
    const onClose = vi.fn();
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={onClose}>
        <ContextMenu.Item label="open in gitlab" onClick={noop} />
      </ContextMenu>,
    );

    rootOf(screen.container).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("is not modal: an outside click reaches the element under it, and the page is not scroll-locked", async () => {
    const onClose = vi.fn();
    const onOutside = vi.fn();
    const screen = await renderWithTheme(
      <>
        <button type="button" style={{ position: "fixed", left: 300, top: 300 }} onClick={onOutside}>
          another row
        </button>
        <ContextMenu x={40} y={40} ariaLabel="m" onClose={onClose}>
          <ContextMenu.Item label="open in gitlab" onClick={noop} />
        </ContextMenu>
      </>,
    );
    await settledBox(rootOf(screen.container));

    expect(getComputedStyle(document.documentElement).overflow).not.toBe("hidden");
    expect(getComputedStyle(document.body).overflow).not.toBe("hidden");
    await screen.getByRole("button", { name: "another row" }).click();
    expect(onOutside).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("gives focus back to where it was when the caller closes it", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            row
          </button>
          {open && (
            <ContextMenu x={40} y={40} ariaLabel="m" onClose={() => setOpen(false)}>
              <ContextMenu.Item label="open in gitlab" onClick={noop} />
            </ContextMenu>
          )}
        </>
      );
    }
    const screen = await renderWithTheme(<Harness />);
    const row = screen.getByRole("button", { name: "row" });
    await row.click();
    const root = rootOf(screen.container);
    await expect.poll(() => root.contains(document.activeElement)).toBe(true);

    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.activeElement).toBe(row.element());
  });

  it("closes on scroll and on resize", async () => {
    const onScrollClose = vi.fn();
    const screenA = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={onScrollClose}>
        <ContextMenu.Item label="open in gitlab" onClick={noop} />
      </ContextMenu>,
    );
    window.dispatchEvent(new Event("scroll"));
    expect(onScrollClose).toHaveBeenCalledTimes(1);
    await screenA.unmount();

    const onResizeClose = vi.fn();
    await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={onResizeClose}>
        <ContextMenu.Item label="open in gitlab" onClick={noop} />
      </ContextMenu>,
    );
    window.dispatchEvent(new Event("resize"));
    expect(onResizeClose).toHaveBeenCalledTimes(1);
  });

  it("tears its listeners down on unmount", async () => {
    const onClose = vi.fn();
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={onClose}>
        <ContextMenu.Item label="open in gitlab" onClick={noop} />
      </ContextMenu>,
    );
    await screen.unmount();

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    await userEvent.keyboard("{Escape}");

    expect(onClose).not.toHaveBeenCalled();
  });

  it("stamps a stable data-part on every slot", async () => {
    // Literals, not CONTEXTMENU_PARTS references: the point of this case is
    // that the CONTRACT's values are what they are, so reading them out of the
    // constant under test would make it vacuous.
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop}>
        <ContextMenu.Label>!42</ContextMenu.Label>
        <ContextMenu.Item label="review" hint="herdr" onClick={noop} />
        <ContextMenu.Separator />
      </ContextMenu>,
    );

    for (const part of [
      "contextmenu",
      "contextmenu-item",
      "contextmenu-label",
      "contextmenu-separator",
      "contextmenu-hint",
    ]) {
      expect(partsIn(screen.container, part), part).toHaveLength(1);
    }
  });

  it("a consumer-supplied data-part does not win, on the root or on a part", async () => {
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop} data-part="hijacked-root">
        <ContextMenu.Item label="review" onClick={noop} data-part="hijacked-item" />
        <ContextMenu.Label data-part="hijacked-label">!42</ContextMenu.Label>
        <ContextMenu.Separator data-part="hijacked-sep" />
      </ContextMenu>,
    );

    expect(screen.container.querySelectorAll('[data-part^="hijacked"]')).toHaveLength(0);
    expect(partsIn(screen.container, "contextmenu")).toHaveLength(1);
    expect(partsIn(screen.container, "contextmenu-item")).toHaveLength(1);
  });

  it("never hand-emits the vocabulary-axis data attributes", async () => {
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop}>
        <ContextMenu.Item label="review" onClick={noop} />
      </ContextMenu>,
    );
    const root = rootOf(screen.container);

    expect(root.getAttribute("data-variant")).toBeNull();
    expect(root.getAttribute("data-intent")).toBeNull();
    expect(root.getAttribute("data-size")).toBeNull();
  });

  it("applies its layered stylesheet to the root and to every part", async () => {
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop}>
        <ContextMenu.Label>!42</ContextMenu.Label>
        <ContextMenu.Item label="review" hint="herdr" onClick={noop} />
        <ContextMenu.Separator />
      </ContextMenu>,
    );
    const root = rootOf(screen.container);

    // `.tui-menu`'s radius (a bare <div> has none), and the stacking order on
    // the fixed box that positions it.
    const rootStyle = getComputedStyle(root);
    const positioner = getComputedStyle(root.parentElement as HTMLElement);
    expect(positioner.position).toBe("fixed");
    expect(positioner.zIndex).toBe("200");
    expect(rootStyle.borderRadius).toBe("8px");
    expect(rootStyle.minWidth).toBe("200px");

    // `.tui-menu-item`'s flex row (a bare <button> is inline-block).
    const item = partsIn(screen.container, CONTEXTMENU_PARTS.item)[0] as HTMLElement;
    expect(getComputedStyle(item).display).toBe("flex");
    expect(getComputedStyle(item).justifyContent).toBe("space-between");

    // `.tui-menu-sep`'s 1px rule, and `.tui-menu-label`'s sans face.
    const sep = partsIn(screen.container, CONTEXTMENU_PARTS.separator)[0] as HTMLElement;
    expect(getComputedStyle(sep).height).toBe("1px");
    const label = partsIn(screen.container, CONTEXTMENU_PARTS.label)[0] as HTMLElement;
    expect(getComputedStyle(label).fontFamily).toContain("-apple-system");
  });

  it("the item's declared width is an OUTER measure, so it never overflows the menu", async () => {
    // mr-board's `.tui-menu-item` is `width: 100%` inside a `padding: 4px`
    // menu and relies on a GLOBAL `* { box-sizing: border-box }` reset. This
    // kit's copy of that reset is in the OPTIONAL src/canvas.css (the browser
    // tier loads theme.css only), so the recipe declares it itself.
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop}>
        <ContextMenu.Item label="review" onClick={noop} />
      </ContextMenu>,
    );

    const rootBox = await settledBox(rootOf(screen.container));
    const item = partsIn(screen.container, CONTEXTMENU_PARTS.item)[0] as HTMLElement;
    const itemBox = item.getBoundingClientRect();

    expect(itemBox.right).toBeLessThanOrEqual(rootBox.right + 0.5);
    expect(itemBox.left).toBeGreaterThanOrEqual(rootBox.left - 0.5);
  });

  it("accepts universal style props with zero recipe wiring", async () => {
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop} p="lg">
        <ContextMenu.Item label="review" onClick={noop} />
      </ContextMenu>,
    );

    // tuiTheme's --spacing-lg is 0.7rem, i.e. 11.2px at a 16px root.
    expect(getComputedStyle(rootOf(screen.container)).paddingTop).toBe("11.2px");
  });

  it("keeps the clamped position when a consumer also passes a style prop", async () => {
    // The positioning style is computed by the recipe and merged ON TOP of
    // whatever `getStyles` produced, so a consumer `style` can dress the menu
    // without knocking it off its anchor.
    const screen = await renderWithTheme(
      <ContextMenu x={60} y={70} ariaLabel="m" onClose={noop} style={{ opacity: "0.5" }}>
        <ContextMenu.Item label="review" onClick={noop} />
      </ContextMenu>,
    );

    const root = rootOf(screen.container);
    const box = await settledBox(root);
    expect(getComputedStyle(root).opacity).toBe("0.5");
    expect(Math.abs(box.left - 60)).toBeLessThan(0.5);
    expect(Math.abs(box.top - 70)).toBeLessThan(0.5);
  });

  it("focuses initialFocusRef once the menu is up", async () => {
    function Menu() {
      const textareaRef = useRef<HTMLTextAreaElement | null>(null);
      return (
        <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop} initialFocusRef={textareaRef}>
          <ContextMenu.Item label="open in gitlab" onClick={noop} />
          <textarea ref={textareaRef} aria-label="note" />
        </ContextMenu>
      );
    }
    const screen = await renderWithTheme(<Menu />);
    await settledBox(rootOf(screen.container));

    const textarea = screen.getByRole("textbox", { name: "note" }).element();
    expect(document.activeElement).toBe(textarea);
  });

  it("a field in the menu takes every key typed into it, and its arrow keys move the caret, not the menu", async () => {
    function Menu() {
      const textareaRef = useRef<HTMLTextAreaElement | null>(null);
      return (
        <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop} initialFocusRef={textareaRef}>
          <ContextMenu.Item label="open in gitlab" onClick={noop} />
          <textarea ref={textareaRef} aria-label="note" />
        </ContextMenu>
      );
    }
    const screen = await renderWithTheme(<Menu />);
    await settledBox(rootOf(screen.container));
    const textarea = screen.getByRole("textbox", { name: "note" }).element() as HTMLTextAreaElement;
    await expect.poll(() => document.activeElement).toBe(textarea);

    await userEvent.keyboard("hello world");
    expect(textarea.value).toBe("hello world");

    await userEvent.keyboard("{Enter}two");
    await userEvent.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(textarea);
    await userEvent.keyboard("!");
    expect(textarea.value).toBe("hel!lo world\ntwo");

    await userEvent.keyboard("{Home}{End}");
    expect(document.activeElement).toBe(textarea);
  });

  it("Tab and Shift+Tab move between the menu's fields and leave it open", async () => {
    const onClose = vi.fn();
    function Menu() {
      const textareaRef = useRef<HTMLTextAreaElement | null>(null);
      return (
        <ContextMenu x={40} y={40} ariaLabel="m" onClose={onClose} initialFocusRef={textareaRef}>
          <ContextMenu.Item label="open in gitlab" onClick={noop} />
          <textarea ref={textareaRef} aria-label="note" />
          <input aria-label="author" />
        </ContextMenu>
      );
    }
    const screen = await renderWithTheme(<Menu />);
    const note = screen.getByRole("textbox", { name: "note" }).element();
    const author = screen.getByRole("textbox", { name: "author" }).element();
    await expect.poll(() => document.activeElement).toBe(note);

    await userEvent.keyboard("{Tab}");
    expect(document.activeElement).toBe(author);
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toBe(note);
    expect(partsIn(screen.container, CONTEXTMENU_PARTS.root)).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps initialFocusRef focused when it is not the menu's first tabbable", async () => {
    // The board's scheme menu points this at its checked item. Items are not
    // tabbable until highlighted, so the menu's own default would be to focus
    // itself, a frame after mount; the ref must still win.
    function Menu() {
      const checkedRef = useRef<HTMLButtonElement | null>(null);
      return (
        <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop} initialFocusRef={checkedRef}>
          <ContextMenu.Item label="system" onClick={noop} />
          <ContextMenu.Item ref={checkedRef} label="dark" onClick={noop} />
        </ContextMenu>
      );
    }
    const screen = await renderWithTheme(<Menu />);
    await settledBox(rootOf(screen.container));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "dark" }).element());
  });

  it("without initialFocusRef, focus still moves into the menu", async () => {
    function Menu() {
      const textareaRef = useRef<HTMLTextAreaElement | null>(null);
      return (
        <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop}>
          <ContextMenu.Item label="open in gitlab" onClick={noop} />
          <textarea ref={textareaRef} aria-label="note" />
        </ContextMenu>
      );
    }
    const screen = await renderWithTheme(<Menu />);
    const root = rootOf(screen.container);
    await settledBox(root);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    expect(document.activeElement).toBe(root);
    expect(document.activeElement).not.toBe(screen.getByRole("textbox", { name: "note" }).element());
  });

  it("a keyed swap to a second menu leaves focus on that menu's initialFocusRef", async () => {
    // The board's note stage: clicking an item remounts the menu under a new
    // key whose only field must take focus, even though something outside
    // held focus before the first menu opened.
    function Stages() {
      const noteRef = useRef<HTMLTextAreaElement | null>(null);
      const [stage, setStage] = useState<"closed" | "items" | "noting">("closed");
      return (
        <>
          <button type="button">search</button>
          {/* Opens the menu without taking focus from "search". */}
          <button
            type="button"
            style={{ position: "fixed", left: 200, top: 300 }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setStage("items")}
          >
            row
          </button>
          {stage === "noting" && (
            <ContextMenu key="noting" x={40} y={40} ariaLabel="note" onClose={noop} initialFocusRef={noteRef}>
              <textarea ref={noteRef} aria-label="launch note" />
            </ContextMenu>
          )}
          {stage === "items" && (
            <ContextMenu key="items" x={40} y={40} ariaLabel="m" onClose={noop}>
              <ContextMenu.Item label="review" onClick={() => setStage("noting")} />
            </ContextMenu>
          )}
        </>
      );
    }
    for (const activate of ["pointer", "keyboard"] as const) {
      const screen = await renderWithTheme(<Stages />);
      const search = screen.getByRole("button", { name: "search" }).element() as HTMLElement;
      search.focus();
      await screen.getByRole("button", { name: "row" }).click();
      await expect.poll(() => partsIn(screen.container, CONTEXTMENU_PARTS.root).length).toBe(1);
      await settledBox(rootOf(screen.container));
      // The menu took focus from "search", so closing it would hand focus back there.
      expect(document.activeElement).not.toBe(search);

      const review = screen.getByRole("menuitem", { name: "review" });
      if (activate === "pointer") {
        await review.click();
      } else {
        await userEvent.keyboard("{ArrowDown}");
        await expect.element(review).toHaveFocus();
        await userEvent.keyboard("{Enter}");
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      expect(document.activeElement, activate).toBe(
        screen.getByRole("textbox", { name: "launch note" }).element(),
      );
      await screen.unmount();
    }
  });

  it("the arrow keys move focus from item to item", async () => {
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop}>
        <ContextMenu.Item label="open in gitlab" onClick={noop} />
        <ContextMenu.Item label="copy for slack" onClick={noop} />
      </ContextMenu>,
    );
    const root = rootOf(screen.container);
    await expect.poll(() => root.contains(document.activeElement)).toBe(true);

    await userEvent.keyboard("{ArrowDown}");
    await expect.element(screen.getByRole("menuitem", { name: "open in gitlab" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(screen.getByRole("menuitem", { name: "copy for slack" })).toHaveFocus();
  });

  it("calls onPositioned once the clamp has committed", async () => {
    const onPositioned = vi.fn();
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop} onPositioned={onPositioned}>
        <ContextMenu.Item label="open in gitlab" onClick={noop} />
      </ContextMenu>,
    );
    await settledBox(rootOf(screen.container));

    expect(onPositioned).toHaveBeenCalledTimes(1);
  });

  it("extend threads defaultProps (invariant 1 stays load-bearing)", async () => {
    const extended = createTheme({
      extends: tuiTheme,
      components: [ContextMenu.extend({ defaultProps: { ariaLabel: "themed label" } })],
    });

    const screen = await renderWithTheme(
      // @ts-expect-error -- `ariaLabel` is required on the own type; the theme
      // default satisfies it at runtime, which is exactly what this pins.
      <ContextMenu x={40} y={40} onClose={noop}>
        <ContextMenu.Item label="review" onClick={noop} />
      </ContextMenu>,
      undefined,
      extended,
    );

    await expect.element(screen.getByRole("menu", { name: "themed label" })).toBeVisible();
  });
});

describe("ContextMenu.Sub (browser)", () => {
  const menu = (x = 40, onClose = noop) => (
    <ContextMenu x={x} y={40} ariaLabel="m" onClose={onClose}>
      <ContextMenu.Item label="review" onClick={noop} />
      <ContextMenu.Sub label="gitlab" ariaLabel="gitlab actions">
        <ContextMenu.Item label="merge" onClick={noop} />
        <ContextMenu.Item label="open in gitlab" onClick={noop} />
      </ContextMenu.Sub>
    </ContextMenu>
  );

  const submenuIn = (container: HTMLElement) =>
    container.querySelector<HTMLElement>(`[data-part="${CONTEXTMENU_PARTS.submenu}"]`);

  // The default viewport is too narrow for a menu and its panel side by side,
  // so the panel would clamp over its own row and intercept the row's clicks.
  beforeEach(async () => {
    await page.viewport(1000, 700);
  });

  it("a field in the submenu takes the keys typed into it", async () => {
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop}>
        <ContextMenu.Sub label="note" ariaLabel="note actions">
          <ContextMenu.Item label="save" onClick={noop} />
          <input aria-label="note text" />
        </ContextMenu.Sub>
      </ContextMenu>,
    );
    await screen.getByRole("menuitem", { name: "note", exact: true }).click();
    const field = screen.getByRole("textbox", { name: "note text" });
    await field.click();
    await userEvent.keyboard("ok go{ArrowUp}{Home}!");
    expect((field.element() as HTMLInputElement).value).toBe("!ok go");
    expect(document.activeElement).toBe(field.element());
  });

  it("opens its panel on hover and closes it when the pointer leaves", async () => {
    const screen = await renderWithTheme(menu());
    const row = screen.getByRole("menuitem", { name: "gitlab", exact: true });
    await userEvent.hover(row);
    await expect.element(screen.getByRole("menu", { name: "gitlab actions" })).toBeVisible();
    await userEvent.hover(screen.getByRole("menuitem", { name: "review" }));
    await expect.poll(() => submenuIn(screen.container)).toBeNull();
  });

  it("marks the row as a menu opener", async () => {
    const screen = await renderWithTheme(menu());
    const row = screen.getByRole("menuitem", { name: "gitlab", exact: true }).element();
    expect(row.getAttribute("aria-haspopup")).toBe("menu");
    expect(row.getAttribute("aria-expanded")).toBe("false");
  });

  it("a click opens the panel and a second click keeps it open", async () => {
    const screen = await renderWithTheme(menu());
    const row = screen.getByRole("menuitem", { name: "gitlab", exact: true });
    await row.click();
    await expect.element(screen.getByRole("menu", { name: "gitlab actions" })).toBeVisible();
    await row.click();
    expect(submenuIn(screen.container)).not.toBeNull();
    expect(row.element().getAttribute("aria-expanded")).toBe("true");
  });

  it("Escape closes only the submenu, a second Escape closes the menu", async () => {
    const onClose = vi.fn();
    const screen = await renderWithTheme(menu(40, onClose));
    await screen.getByRole("menuitem", { name: "gitlab", exact: true }).click();
    await expect.element(screen.getByRole("menu", { name: "gitlab actions" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => submenuIn(screen.container)).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ArrowRight opens and focuses the first item; ArrowLeft closes and refocuses the row", async () => {
    const screen = await renderWithTheme(menu());
    const row = screen.getByRole("menuitem", { name: "gitlab", exact: true }).element() as HTMLButtonElement;
    row.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(screen.getByRole("menuitem", { name: "merge" })).toHaveFocus();
    expect(row.hasAttribute("data-popup-open")).toBe(true);
    // The row stays washed while its panel is open, so the two read as linked.
    const washed = getComputedStyle(row).backgroundColor;
    const idle = getComputedStyle(screen.getByRole("menuitem", { name: "review" }).element()).backgroundColor;
    expect(washed).not.toBe(idle);
    await userEvent.keyboard("{ArrowLeft}");
    await expect.poll(() => submenuIn(screen.container)).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it("inside the submenu the arrow keys move only within it, and the menu stays open", async () => {
    const onClose = vi.fn();
    const screen = await renderWithTheme(menu(40, onClose));
    const row = screen.getByRole("menuitem", { name: "gitlab", exact: true }).element() as HTMLButtonElement;
    row.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(screen.getByRole("menuitem", { name: "merge" })).toHaveFocus();

    await userEvent.keyboard("{ArrowDown}");
    await expect.element(screen.getByRole("menuitem", { name: "open in gitlab" })).toHaveFocus();
    const review = screen.getByRole("menuitem", { name: "review" }).element();
    expect(review.hasAttribute("data-highlighted")).toBe(false);
    expect(submenuIn(screen.container)).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Enter and Space on the row both open the panel and focus its first item", async () => {
    for (const key of ["{Enter}", " "]) {
      const screen = await renderWithTheme(menu());
      const row = screen.getByRole("menuitem", { name: "gitlab", exact: true }).element() as HTMLButtonElement;
      row.focus();
      await userEvent.keyboard(key);
      await expect.element(screen.getByRole("menuitem", { name: "merge" })).toHaveFocus();
      await screen.unmount();
    }
  });

  it("a mousedown or a click inside the submenu does not close the menu", async () => {
    const onClose = vi.fn();
    const onMerge = vi.fn();
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={onClose}>
        <ContextMenu.Item label="review" onClick={noop} />
        <ContextMenu.Sub label="gitlab" ariaLabel="gitlab actions">
          <ContextMenu.Item label="merge" onClick={onMerge} />
        </ContextMenu.Sub>
      </ContextMenu>,
    );
    await screen.getByRole("menuitem", { name: "gitlab", exact: true }).click();
    await expect.element(screen.getByRole("menu", { name: "gitlab actions" })).toBeVisible();
    const merge = screen.getByRole("menuitem", { name: "merge" });
    merge.element().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();

    await merge.click();
    expect(onMerge).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(submenuIn(screen.container)).not.toBeNull();
  });

  it("a mousedown outside both the menu and its open submenu closes it", async () => {
    const onClose = vi.fn();
    const screen = await renderWithTheme(menu(40, onClose));
    await screen.getByRole("menuitem", { name: "gitlab", exact: true }).click();
    await expect.element(screen.getByRole("menu", { name: "gitlab actions" })).toBeVisible();

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens to the right, flush on the menu's edge, its first item level with the row", async () => {
    const screen = await renderWithTheme(menu());
    const rootBox = await settledBox(rootOf(screen.container));
    const row = screen.getByRole("menuitem", { name: "gitlab", exact: true });
    await row.click();
    await expect.element(screen.getByRole("menu", { name: "gitlab actions" })).toBeVisible();
    const box = submenuIn(screen.container)!.getBoundingClientRect();
    const first = screen.getByRole("menuitem", { name: "merge" }).element().getBoundingClientRect();
    expect(Math.abs(box.left - rootBox.right)).toBeLessThan(1);
    expect(Math.abs(first.top - row.element().getBoundingClientRect().top)).toBeLessThan(1);
  });

  it("flips to the left of the menu when there is no room on the right", async () => {
    const screen = await renderWithTheme(menu(window.innerWidth));
    const rootBox = await settledBox(rootOf(screen.container));
    const row = screen.getByRole("menuitem", { name: "gitlab", exact: true });
    await row.click();
    await expect.element(screen.getByRole("menu", { name: "gitlab actions" })).toBeVisible();
    const box = await settledBox(submenuIn(screen.container)!);
    expect(box.right).toBeLessThanOrEqual(window.innerWidth - MARGIN + 0.5);
    expect(box.left).toBeGreaterThanOrEqual(MARGIN - 0.5);
    expect(Math.abs(box.right - rootBox.left)).toBeLessThan(1);
  });

  it("widens for a long row instead of wrapping it, on both the right and the flipped side", async () => {
    for (const x of [40, window.innerWidth]) {
      const screen = await renderWithTheme(
        <ContextMenu x={x} y={40} ariaLabel="m" onClose={noop}>
          <ContextMenu.Sub label="gitlab" ariaLabel="gitlab actions">
            <ContextMenu.Item label="merge" onClick={noop} />
            <ContextMenu.Item
              label="ask alice's agent to re-review"
              hint="ask already sent"
              onClick={noop}
            />
          </ContextMenu.Sub>
        </ContextMenu>,
      );
      await settledBox(rootOf(screen.container));
      await screen.getByRole("menuitem", { name: "gitlab", exact: true }).click();
      await expect.element(screen.getByRole("menu", { name: "gitlab actions" })).toBeVisible();

      const short = screen.getByRole("menuitem", { name: "merge" }).element().getBoundingClientRect();
      const long = screen
        .getByRole("menuitem", { name: /re-review/ })
        .element()
        .getBoundingClientRect();
      expect(long.height, `x=${x}`).toBeCloseTo(short.height, 0);

      const box = submenuIn(screen.container)!.getBoundingClientRect();
      expect(box.left, `x=${x}`).toBeGreaterThanOrEqual(MARGIN - 0.5);
      expect(box.right, `x=${x}`).toBeLessThanOrEqual(window.innerWidth - MARGIN + 0.5);
      await screen.unmount();
    }
  });

  it("stamps a stable data-part on the Sub, its panel, its chevron and a Row", async () => {
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop}>
        <ContextMenu.Row aria-label="reactions">
          <ContextMenu.Item label="a" onClick={noop} />
        </ContextMenu.Row>
        <ContextMenu.Sub label="gitlab" ariaLabel="gitlab actions" data-part="hijacked">
          <ContextMenu.Item label="merge" onClick={noop} />
        </ContextMenu.Sub>
      </ContextMenu>,
    );
    await screen.getByRole("menuitem", { name: "gitlab", exact: true }).click();
    await expect.element(screen.getByRole("menu", { name: "gitlab actions" })).toBeVisible();

    for (const part of [
      "contextmenu-sub",
      "contextmenu-submenu",
      "contextmenu-chevron",
      "contextmenu-row",
    ]) {
      expect(partsIn(screen.container, part), part).toHaveLength(1);
    }
    expect(partsIn(screen.container, "hijacked")).toHaveLength(0);
  });

  it("a disabled Sub never opens, by pointer or keyboard, and logs no warning", async () => {
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    try {
      const screen = await renderWithTheme(
        <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop}>
          <ContextMenu.Sub label="gitlab" ariaLabel="gitlab actions" disabled>
            <ContextMenu.Item label="merge" onClick={noop} />
          </ContextMenu.Sub>
        </ContextMenu>,
      );
      const row = screen.getByRole("menuitem", { name: "gitlab", exact: true });
      const button = row.element() as HTMLButtonElement;
      expect(button.getAttribute("aria-disabled")).toBe("true");
      button.click();
      await userEvent.hover(row);
      // Longer than the hover-open delay, so a hover that was going to open it has.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(submenuIn(screen.container)).toBeNull();

      button.focus();
      await userEvent.keyboard("{ArrowRight}");
      await userEvent.keyboard("{Enter}");
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(submenuIn(screen.container)).toBeNull();

      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });
});

describe("ContextMenu Escape over another layer (browser)", () => {
  function MenuOverDrawer({ onDrawerClose }: { onDrawerClose: () => void }) {
    const [menu, setMenu] = useState(true);
    const [drawer, setDrawer] = useState(true);
    return (
      <>
        {drawer && (
          <SideDrawer
            side="right"
            ariaLabel="comments"
            onClose={() => {
              setDrawer(false);
              onDrawerClose();
            }}
          >
            drawer body
          </SideDrawer>
        )}
        {menu && (
          <ContextMenu x={40} y={40} ariaLabel="m" onClose={() => setMenu(false)}>
            <ContextMenu.Item label="review" onClick={noop} />
            <ContextMenu.Sub label="gitlab" ariaLabel="gitlab actions">
              <ContextMenu.Item label="merge" onClick={noop} />
            </ContextMenu.Sub>
          </ContextMenu>
        )}
      </>
    );
  }

  beforeEach(async () => {
    await page.viewport(1000, 700);
  });

  it("Escape closes the menu and leaves the drawer under it open; a second Escape closes the drawer", async () => {
    const onDrawerClose = vi.fn();
    const screen = await renderWithTheme(<MenuOverDrawer onDrawerClose={onDrawerClose} />);
    const root = rootOf(screen.container);
    await expect.poll(() => root.contains(document.activeElement)).toBe(true);

    await userEvent.keyboard("{Escape}");
    await expect.poll(() => partsIn(screen.container, CONTEXTMENU_PARTS.root).length).toBe(0);
    expect(onDrawerClose).not.toHaveBeenCalled();

    await userEvent.keyboard("{Escape}");
    expect(onDrawerClose).toHaveBeenCalledTimes(1);
  });

  it("with a submenu open, Escape closes the submenu, then the menu, then the drawer", async () => {
    const onDrawerClose = vi.fn();
    const screen = await renderWithTheme(<MenuOverDrawer onDrawerClose={onDrawerClose} />);
    const row = screen.getByRole("menuitem", { name: "gitlab", exact: true });
    (row.element() as HTMLButtonElement).focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(screen.getByRole("menuitem", { name: "merge" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    await expect
      .poll(() => partsIn(screen.container, CONTEXTMENU_PARTS.submenu).length)
      .toBe(0);
    expect(partsIn(screen.container, CONTEXTMENU_PARTS.root)).toHaveLength(1);

    await userEvent.keyboard("{Escape}");
    await expect.poll(() => partsIn(screen.container, CONTEXTMENU_PARTS.root).length).toBe(0);
    expect(onDrawerClose).not.toHaveBeenCalled();

    await userEvent.keyboard("{Escape}");
    expect(onDrawerClose).toHaveBeenCalledTimes(1);
  });
});

describe("ContextMenu.Row (browser)", () => {
  it("lays its items out on one line, as a labelled group", async () => {
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop}>
        <ContextMenu.Row aria-label="slack reactions">
          <ContextMenu.Item label="👀" aria-label="mark as looking" onClick={noop} />
          <ContextMenu.Item label="💬" aria-label="mark as commented" onClick={noop} />
        </ContextMenu.Row>
      </ContextMenu>,
    );
    await expect.element(screen.getByRole("group", { name: "slack reactions" })).toBeVisible();
    const a = screen.getByRole("menuitem", { name: "mark as looking" }).element().getBoundingClientRect();
    const b = screen.getByRole("menuitem", { name: "mark as commented" }).element().getBoundingClientRect();
    expect(Math.abs(a.top - b.top)).toBeLessThan(1);
    expect(b.left).toBeGreaterThan(a.right - 1);
  });

  it("the arrow keys reach every item in the row", async () => {
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop}>
        <ContextMenu.Item label="post to slack" onClick={noop} />
        <ContextMenu.Row aria-label="slack reactions">
          <ContextMenu.Item label="👀" aria-label="mark as looking" onClick={noop} />
          <ContextMenu.Item label="💬" aria-label="mark as commented" onClick={noop} />
        </ContextMenu.Row>
      </ContextMenu>,
    );
    const root = rootOf(screen.container);
    await expect.poll(() => root.contains(document.activeElement)).toBe(true);

    for (const name of ["post to slack", "mark as looking", "mark as commented"]) {
      await userEvent.keyboard("{ArrowDown}");
      await expect.element(screen.getByRole("menuitem", { name })).toHaveFocus();
    }
  });
});
