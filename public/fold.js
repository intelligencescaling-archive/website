// Side blocks (<details class="fd blk">: Related, Details, Authors, …) are shut folds below 1024 px and open,
// section-looking blocks in the side column from 1024 px (rules A11). Runs at the end of <body>, before the first
// paint, so nothing jumps. Other folds (.fd without .blk, e.g. "Corrections and removal") stay shut everywhere.
(function () {
  var wide = window.matchMedia ? window.matchMedia('(min-width: 1024px)') : null;
  function set() {
    var open = !!(wide && wide.matches);
    var d = document.querySelectorAll('details.fd.blk');
    for (var i = 0; i < d.length; i++) {
      d[i].open = open;
      var s = d[i].querySelector('summary');
      if (!s) continue;
      if (open) s.setAttribute('tabindex', '-1');
      else s.removeAttribute('tabindex');
    }
  }
  set();
  if (wide && wide.addEventListener) wide.addEventListener('change', set);
})();
