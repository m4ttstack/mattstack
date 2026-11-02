// Reads and presses mattstack's buttons through the accessibility API itself.
// System Events cannot read every label: a SwiftUI button that carries its
// label only in AXAttributedDescription has no AXTitle and no AXDescription,
// System Events cannot coerce the attributed string, and its `description`
// falls back to the role description, so the button reads "button".
//
//   osascript -l JavaScript ax-button.js <process> read <axid>
//   osascript -l JavaScript ax-button.js <process> press <axid> <wording>
//   osascript -l JavaScript ax-button.js <process> pick <axid> <option wording>
//
// Lookups run under the process's first window, as `window 1` does in ax.sh.
// A read and the press it guards are one invocation: a read that lands
// between two scripts can change which press this is.

// The role description is what System Events falls back to, and it is never
// a button's wording.
function wordingOf(title, description, attributed, roleDescription) {
  var reads = [title, description, attributed];
  for (var i = 0; i < reads.length; i++) {
    var t = String(reads[i] || "").trim();
    if (t !== "" && t !== "button" && t !== roleDescription) return t;
  }
  return "";
}

function pressHeld(id, want, wording, enabled) {
  if (wording === "") return "press held: " + id + " has no readable wording, wanted " + want;
  if (wording !== want) return "press held: " + id + " reads " + wording + ", wanted " + want;
  if (!enabled) return "press held: " + id + " is disabled";
  return "";
}

function refuse(reason) {
  if (reason !== "") throw new Error(reason);
}

function attr(el, name) {
  var ref = Ref();
  if ($.AXUIElementCopyAttributeValue(el, $(name), ref) != 0) return null;
  return ref[0];
}

function textAt(el, name) {
  var v = attr(el, name);
  if (!v) return "";
  var o = ObjC.castRefToObject(v);
  if (o.isKindOfClass($.NSAttributedString)) return ObjC.unwrap(o.string);
  if (o.isKindOfClass($.NSString)) return ObjC.unwrap(o);
  if (o.isKindOfClass($.NSNumber)) return ObjC.unwrap(o.stringValue);
  return "";
}

function wordingAt(el) {
  return wordingOf(textAt(el, "AXTitle"), textAt(el, "AXDescription"),
    textAt(el, "AXAttributedDescription"), textAt(el, "AXRoleDescription"));
}

function enabledAt(el) {
  var v = attr(el, "AXEnabled");
  return v ? !!ObjC.unwrap(ObjC.castRefToObject(v)) : false;
}

function walk(el, wanted, depth) {
  if (depth > 40) return null;
  if (textAt(el, "AXIdentifier") === wanted) return el;
  var kids = attr(el, "AXChildren");
  if (!kids) return null;
  var arr = ObjC.castRefToObject(kids);
  for (var i = 0; i < arr.count; i++) {
    var r = walk(arr.objectAtIndex(i), wanted, depth + 1);
    if (r) return r;
  }
  return null;
}

function find(win, id) {
  var r = walk(win, id, 0);
  if (!r) throw new Error("axid not found: " + id);
  return r;
}

function firstWindow(proc, pid) {
  var wins = attr($.AXUIElementCreateApplication(pid), "AXWindows");
  var arr = wins ? ObjC.castRefToObject(wins) : null;
  if (!arr || arr.count === 0) throw new Error("no window: " + proc);
  return arr.objectAtIndex(0);
}

function pressEl(el, id) {
  var err = $.AXUIElementPerformAction(el, $("AXPress"));
  if (err != 0) throw new Error("press failed: " + id + " (AX error " + err + ")");
}

function options(el, acc, depth) {
  if (depth > 10) return acc;
  var kids = attr(el, "AXChildren");
  if (!kids) return acc;
  var arr = ObjC.castRefToObject(kids);
  for (var i = 0; i < arr.count; i++) {
    var c = arr.objectAtIndex(i);
    if (textAt(c, "AXRole") === "AXRadioButton") acc.push(c);
    else options(c, acc, depth + 1);
  }
  return acc;
}

// A segment's options carry their wording where System Events cannot read it.
function pick(win, id, want) {
  var all = options(find(win, id), [], 0), seen = [];
  for (var i = 0; i < all.length; i++) {
    var w = wordingAt(all[i]);
    seen.push(w);
    if (w === want) {
      pressEl(all[i], id + " option " + want);
      delay(0.5);
      // The press redraws the screen, so the old element no longer reads.
      var now = options(find(win, id), [], 0);
      for (var j = 0; j < now.length; j++) {
        if (wordingAt(now[j]) !== want) continue;
        // A SwiftUI representation's option may expose no value to check.
        var value = textAt(now[j], "AXValue");
        if (value !== "1" && value !== "") throw new Error("option " + want + " in " + id + " did not take the press (value '" + value + "')");
        return;
      }
      throw new Error("option " + want + " in " + id + " is gone after the press");
    }
  }
  throw new Error("no option " + want + " in " + id + "; options read: [" + seen.join(", ") + "]");
}

function run(argv) {
  ObjC.import("ApplicationServices");
  var proc = argv[0], mode = argv[1];
  var p = Application("System Events").processes.byName(proc);
  if (!p.exists()) throw new Error("process not running: " + proc);
  var pid = p.unixId();
  var b, v;
  if (mode !== "read") p.frontmost = true;
  switch (mode) {
    case "read":
      b = find(firstWindow(proc, pid), argv[2]);
      v = wordingAt(b);
      if (v === "") throw new Error("no readable wording: " + argv[2]);
      return v;
    case "pick":
      pick(firstWindow(proc, pid), argv[2], argv[3]);
      return "";
    case "press":
      b = find(firstWindow(proc, pid), argv[2]);
      refuse(pressHeld(argv[2], argv[3], wordingAt(b), enabledAt(b)));
      pressEl(b, argv[2]);
      return "";
  }
  throw new Error("usage: ax-button.js <process> read <axid> | press <axid> <wording> | pick <axid> <option wording>");
}
