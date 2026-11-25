/* Light / dark switch. By default the site follows the device's setting; the button overrides it and the choice is remembered on this device. Loaded in every page's head, so there is no flash. */
(function () {
  "use strict";
  var KEY = "nn-theme", root = document.documentElement, dark = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : { matches: false };
  var saved = null; try { saved = localStorage.getItem(KEY); } catch (e) {}
  if (saved === "dark" || saved === "light") root.setAttribute("data-theme", saved);
  var isDark = function () { var t = root.getAttribute("data-theme"); return t ? t === "dark" : dark.matches; };
  function addButton() {
    var b = document.createElement("button"); b.type = "button"; b.id = "theme-switch";
    var label = function () { b.textContent = isDark() ? "\u2600 Light" : "\u263e Dark"; b.setAttribute("aria-label", isDark() ? "Switch to light mode" : "Switch to dark mode"); };
    b.style.cssText = "position:fixed;right:.75rem;bottom:.75rem;z-index:50;font:600 14px system-ui,sans-serif;padding:.55rem .9rem;min-height:40px;border-radius:999px;border:1px solid var(--line,#888);background:var(--card,#fff);color:var(--ink,#111);box-shadow:0 2px 10px rgba(0,0,0,.25);cursor:pointer";
    b.onclick = function () { var next = isDark() ? "light" : "dark"; root.setAttribute("data-theme", next); try { localStorage.setItem(KEY, next); } catch (e) {} label(); };
    label(); document.body.appendChild(b); if (window.MutationObserver) new MutationObserver(label).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addButton); else addButton();
})();
