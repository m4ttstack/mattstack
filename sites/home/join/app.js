(function () {
  var state = window.JoinPage.resolveJoinState(window.location.hash);

  var headline = document.getElementById("headline");
  var subtext = document.getElementById("subtext");
  var openBtn = document.getElementById("open");
  var downloadBtn = document.getElementById("download");
  var status = document.getElementById("status");

  function copyInviteLink() {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(state.clipboardText).then(
        function () {
          status.textContent =
            "Copied your invite link. Install mattstack, open it, choose Join a team, and click Paste.";
        },
        function () {
          status.textContent = "Copy this after installing: " + state.clipboardText;
        },
      );
    } else {
      status.textContent = "Copy this after installing: " + state.clipboardText;
    }
  }

  if (state.hasCode) {
    headline.textContent = "You've been invited to a mattstack team.";
    subtext.textContent =
      "Open mattstack if it's already installed. Otherwise download it below. The invite is copied for you, so in setup choose Join a team and click Paste.";
    openBtn.hidden = false;
    openBtn.addEventListener("click", function () {
      window.location.href = state.deepLink;
    });
    // A click carries the user gesture clipboard writes need; a page-load
    // write with no gesture is unreliable across browsers.
    downloadBtn.addEventListener("click", copyInviteLink);

    // Best-effort handoff for an already-installed app; if nothing is
    // registered for the scheme, browsers simply do nothing (no error).
    window.location.href = state.deepLink;
  } else {
    headline.textContent = "This invite link is missing its code.";
    subtext.textContent =
      "Ask whoever sent it for a fresh link, or download mattstack directly below.";
  }

  fetch("https://api.github.com/repos/m4ttstack/mattstack/releases/latest")
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((rel) => {
      const dmg = (rel.assets || []).find((a) => a.name.endsWith(".dmg"));
      const btn = document.getElementById("download");
      const meta = document.getElementById("meta");
      if (dmg) {
        btn.href = dmg.browser_download_url;
        btn.removeAttribute("aria-disabled");
        const mb = (dmg.size / 1048576).toFixed(0);
        meta.textContent = `${rel.tag_name} - ${mb} MB - dmg`;
      } else {
        btn.href = "https://github.com/m4ttstack/mattstack/releases";
        btn.removeAttribute("aria-disabled");
        meta.textContent = "no packaged release yet - see all releases";
      }
    })
    .catch(() => {
      const btn = document.getElementById("download");
      btn.removeAttribute("aria-disabled");
      document.getElementById("meta").textContent = "";
    });
})();
