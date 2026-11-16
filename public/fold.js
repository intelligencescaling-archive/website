// Sections folded into <details class="fold"> are closed on phones and open on wider screens, where
// the page keeps its full layout. Runs at the end of <body>, before the page is shown, so nothing jumps.
(function () {
  var wide = window.matchMedia ? window.matchMedia('(min-width: 768px)') : null;
  function set() {
    var open = !wide || wide.matches;
    var d = document.querySelectorAll('details.fold');
    for (var i = 0; i < d.length; i++) d[i].open = open;
  }
  set();
  if (wide && wide.addEventListener) wide.addEventListener('change', set);
})();
