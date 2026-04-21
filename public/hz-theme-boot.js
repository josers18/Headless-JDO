(function () {
  try {
    var k = "hz-theme";
    var DEF = "horizon-dark";
    var L = "ivory";
    var d = document.documentElement;
    var t = localStorage.getItem(k);
    if (!t) {
      t = window.matchMedia("(prefers-color-scheme: light)").matches ? L : DEF;
    }
    d.setAttribute("data-theme", t);
  } catch (e) {
    /* ignore */
  }
})();
