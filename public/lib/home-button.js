/* XenoXanadu — shared "back to the arcade" button.
 *
 * Drop-in for any game page at public/game/<name>/index.html:
 *     <script src="../../lib/home-button.js"></script>
 *
 * Injects a small floating pill in the top-left that links home. It is fully
 * self-contained — its own scoped styles, no dependency on the host game's CSS,
 * and a z-index above the games' CRT/scanline overlays so it stays clickable.
 * The href is relative to the *page* (two levels deep), so it resolves to
 * public/index.html for every game.
 */
(function () {
  "use strict";
  if (document.querySelector(".xeno-home")) return;   // never double-inject

  var css =
    '.xeno-home{position:fixed;top:12px;left:12px;z-index:2147483000;' +
    'display:inline-flex;align-items:center;gap:7px;padding:7px 13px 7px 11px;' +
    'font:700 12px/1 var(--mono,"SF Mono",Menlo,Consolas,monospace);' +
    'letter-spacing:1.5px;text-transform:uppercase;' +
    'color:var(--accent,#9be36b);text-decoration:none;background:rgba(8,16,10,.8);' +
    'border:1px solid var(--accent,#3a5a32);border-radius:0;' +
    '-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);' +
    'box-shadow:0 2px 12px rgba(0,0,0,.45);' +
    'transition:color .15s,background .15s,box-shadow .15s,transform .08s;}' +
    '.xeno-home:hover{color:var(--on-accent,#0b140d);background:var(--accent,#9be36b);' +
    'box-shadow:0 0 14px var(--accent,#9be36b);transform:translateY(-1px);}' +
    '.xeno-home:active{transform:translateY(0);}' +
    '.xeno-home .xa{font-size:14px;line-height:1;}' +
    '@media print{.xeno-home{display:none;}}';

  function inject() {
    if (document.querySelector(".xeno-home")) return;
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    var a = document.createElement("a");
    a.className = "xeno-home";
    a.href = "../../index.html";
    a.title = "Back to the XenoXanadu arcade";
    a.setAttribute("aria-label", "Back to the arcade");
    a.innerHTML = '<span class="xa" aria-hidden="true">←</span><span>Arcade</span>';
    document.body.appendChild(a);
  }

  if (document.body) inject();
  else document.addEventListener("DOMContentLoaded", inject);
})();
