// "Random doc" links: without JavaScript they go to /search/; with it, to a random entry.
// The id list is fetched on the first click only, and ids are checked before building a URL.
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
let ids = null;

export function initRandom() {
  for (const link of document.querySelectorAll('a[data-random]')) {
    link.addEventListener('click', async (ev) => {
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
      ev.preventDefault();
      try {
        ids ??= (await (await fetch('/random-ids.json')).json()).filter((x) => typeof x === 'string' && SLUG.test(x));
        if (!ids.length) throw new Error('empty');
        const here = location.pathname.split('/')[2];
        let id;
        do id = ids[Math.floor(Math.random() * ids.length)];
        while (ids.length > 1 && id === here);
        location.href = `/items/${id}/`;
      } catch {
        location.href = link.href;
      }
    });
  }
}
