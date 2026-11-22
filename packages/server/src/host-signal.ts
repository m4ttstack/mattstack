export { bootId, buildIdOf, type HealthState } from './instance';

/**
 * Talks to the mattstack window's `mattstackHost` WebKit message handler.
 * Plain ES2019 with no imports: it runs inline in `<head>`, before any
 * bundle, in every browser that opens the page.
 */
export function hostSignalScript(buildId: string | null): string {
  const id = JSON.stringify(buildId).replace(/</g, '\\u003c');
  return `<script>(function () {
  var buildId = ${id};
  function post(message) {
    try {
      var w = window.webkit;
      var handler = w && w.messageHandlers && w.messageHandlers.mattstackHost;
      if (handler) handler.postMessage(message);
    } catch (e) {}
  }
  function sameOrigin(link) {
    try {
      return new URL(link.href, window.location.href).origin === window.location.origin;
    } catch (e) {
      return false;
    }
  }
  function hasRules(sheet) {
    if (!sheet) return false;
    try {
      return sheet.cssRules.length > 0;
    } catch (e) {
      return true;
    }
  }
  // A stylesheet that failed before ready() looks like one still loading
  // (no sheet, its error already fired), so outcomes are recorded from the start.
  var outcomes = new WeakMap();
  function record(type) {
    return function (event) {
      if (event.target && event.target.tagName === 'LINK') outcomes.set(event.target, type);
    };
  }
  document.addEventListener('load', record('load'), true);
  document.addEventListener('error', record('error'), true);
  var readyCalled = false;
  function ready() {
    if (readyCalled) return;
    readyCalled = true;
    var links = Array.prototype.filter.call(
      document.querySelectorAll('link[rel~="stylesheet"]'),
      function (link) { return !link.disabled && sameOrigin(link); }
    );
    var pending = links.length;
    function finish() {
      for (var i = 0; i < links.length; i++) {
        if (outcomes.get(links[i]) === 'error' || !hasRules(links[i].sheet)) {
          post({ type: 'failed', reason: 'stylesheet ' + links[i].href });
          return;
        }
      }
      post({ type: 'ready', buildId: buildId });
    }
    function settle() {
      pending -= 1;
      if (pending === 0) finish();
    }
    if (pending === 0) return finish();
    links.forEach(function (link) {
      if (link.sheet || outcomes.has(link)) return settle();
      var settled = false;
      function once() {
        if (settled) return;
        settled = true;
        settle();
      }
      link.addEventListener('load', once);
      link.addEventListener('error', once);
    });
  }
  window.__mattstackHost = {
    ready: ready,
    failed: function (reason) { post({ type: 'failed', reason: reason }); },
    fatal: function () { post({ type: 'fatal' }); }
  };
  post({ type: 'booting' });
})();</script>`;
}

export function injectHostSignal(html: string, buildId: string | null): string {
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (!head) return html;
  const at = head.index + head[0].length;
  return html.slice(0, at) + hostSignalScript(buildId) + html.slice(at);
}
