// packages/mod-kit/src/patterns/hideable-pane.tsx
async function showPane($, pane, title) {
  await $.ui.open({ id: pane.id, title, focus: true });
  $.ui.invalidate("ui.render");
}
async function paneMessage($, e, pane, waiting) {
  const message = e.data;
  if (message?.type === "reopen" && waiting && waiting.formId === message.formId)
    await showPane($, pane, waiting.title);
  if (message?.type === "hide" && e.requestId === pane.id)
    await $.ui.close({ id: pane.id });
}
// mods/kit-gallery/src/register.tsx
var PANE = "kit-gallery";
var TITLE = "Kit gallery";
var GALLERY_PANE = { id: PANE };
function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({ name: "kit-gallery", description: "Open the mod kit gallery: every kit piece, drawn live" });
    return next(e);
  });
  on("command.run", { command: "kit-gallery" }, async ($) => {
    await showPane($, GALLERY_PANE, TITLE);
    return { text: `${TITLE} opened.` };
  });
  on("ui.message", async ($, e, next) => {
    await paneMessage($, e, GALLERY_PANE, undefined);
    return next(e);
  });
  on("ui.render", { component: "Pane", requestId: "kit-gallery" }, async ($, e) => {
    const els = $.ui.resolve(e);
    const { Box, Text } = els;
    const Client = "Client" in els ? els.Client : undefined;
    if (!Client)
      return /* @__PURE__ */ h(Text, {
        dimColor: true
      }, "This screen can't draw the gallery. Open it in the terminal or the desktop app.");
    return /* @__PURE__ */ h(Box, {
      flexDirection: "column",
      paddingX: 1
    }, /* @__PURE__ */ h(Client, {
      key: "gallery",
      module: "./gallery.js",
      props: { cols: (e.props.bodyColumns ?? 60) - 2 }
    }));
  });
}
export {
  register
};
