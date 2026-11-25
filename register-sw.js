/* Registers the offline service worker (kept in its own file so pages with a strict security policy need no inline script). */
if ("serviceWorker" in navigator) navigator.serviceWorker.register(new URL("sw.js", document.currentScript.src).href, { updateViaCache: "none" }).catch(function () {});
