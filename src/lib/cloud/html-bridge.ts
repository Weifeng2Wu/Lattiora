// Ported from b6320ce5 features/web/proxy.rs; only this trusted script runs in the opaque frame.
export const HTML_READER_BRIDGE = String.raw`(function () {
  try {
    // Only the top-level proxied document talks to the app. A nested frame on
    // the same proxy origin has a readable parent and stays uninstrumented.
    try {
      if (parent === window) return;
      void parent.location.href;
      return;
    } catch (e) {}
    var post = function (message) {
      message.source = "agentero-web";
      parent.postMessage(message, "*");
    };
    // The upstream host rides in the first path segment of the proxy URL.
    var host = "";
    try {
      host = new URL(document.baseURI).hostname;
    } catch (e) {}

    // ---- selection → app toolbar -----------------------------------------
    var MAX_SELECTION_CHARS = 4000;
    var sendSelection = function () {
      var text = "";
      var rect = null;
      var sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        text = (sel.toString() || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, MAX_SELECTION_CHARS);
        if (text) {
          var r = sel.getRangeAt(0).getBoundingClientRect();
          if (r.width !== 0 || r.height !== 0) {
            rect = { x: r.left, y: r.top, width: r.width, height: r.height };
          }
        }
      }
      if (text && rect) {
        // Raw copy inside the frame: the app's clipboard write can be refused
        // while focus sits in this cross-origin frame.
        try { document.execCommand("copy"); } catch (e) {}
      }
      post({ type: "selection", text: text, rect: rect, url: document.baseURI });
    };
    var scheduleSelection = function () {
      // Let the browser finish updating the selection first.
      requestAnimationFrame(function () { setTimeout(sendSelection, 0); });
    };
    document.addEventListener("mouseup", scheduleSelection);
    document.addEventListener("keyup", function (event) {
      var key = event.key || "";
      if (key === "Shift" || key.indexOf("Arrow") === 0) scheduleSelection();
    });

    // The app hides its toolbar while the page scrolls (plaza parity).
    var scrollPending = false;
    window.addEventListener("scroll", function () {
      if (scrollPending) return;
      scrollPending = true;
      setTimeout(function () {
        scrollPending = false;
        post({ type: "scroll" });
      }, 150);
    }, true);

    // ---- shortcuts → app handlers -----------------------------------------
    // Keyboard events land in this frame, never in the app window; ⌘K / ⌘L
    // must be carried over explicitly.
    var isEditable = function (el) {
      if (!el || !el.nodeName) return false;
      var name = el.nodeName.toLowerCase();
      return (
        name === "input" ||
        name === "textarea" ||
        name === "select" ||
        el.isContentEditable === true
      );
    };
    document.addEventListener("keydown", function (event) {
      if (event.altKey || !(event.metaKey || event.ctrlKey)) return;
      if (isEditable(event.target)) return;
      var key = (event.key || "").toLowerCase();
      if (key !== "k" && key !== "l") return;
      event.preventDefault();
      post({ type: "shortcut", id: key === "k" ? "quickChat" : "addToChat" });
    }, true);

    // ---- navigation policy --------------------------------------------------
    // Same-site navigations stay inside the proxy so the bridge survives;
    // everything else belongs to the system browser, where the user has a
    // real session.
    document.addEventListener("click", function (event) {
      var anchor =
        event.target && event.target.closest
          ? event.target.closest("a[href]")
          : null;
      if (!anchor) return;
      var raw = anchor.getAttribute("href");
      if (!raw || raw.charAt(0) === "#" || /^javascript:/i.test(raw)) return;
      var url;
      try {
        url = new URL(anchor.href, document.baseURI);
      } catch (e) {
        return;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        // Never leak our private scheme to the system browser.
        event.preventDefault();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (host && url.hostname === host) {
        post({ type: "navigate", url: url.href });
        return;
      }
      post({ type: "external", url: url.href });
    }, true);

    // ---- app → frame --------------------------------------------------------
    window.addEventListener("message", function (event) {
      if (event.source !== parent) return;
      var data = event.data;
      if (!data || data.source !== "agentero-web-host") return;
      if (data.type === "clearSelection") {
        var sel = window.getSelection();
        if (sel) sel.removeAllRanges();
      } else if (data.type === "copySelection") {
        try { document.execCommand("copy"); } catch (e) {}
      }
    });
  } catch (e) {}
})();`;
