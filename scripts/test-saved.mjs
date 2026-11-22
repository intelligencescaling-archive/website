// Checks Save for later's storage rules in public/theme.js (no browser: a tiny fake window). Run: npm run test:saved
// Blocked or broken storage must never throw; saves go newest first; a second click removes; bad data is ignored.
// The real pages (Library list, CLS, both themes) are checked in a browser; see README "Save for later".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../public/theme.js', import.meta.url), 'utf8');

function run({ path = '/items/a/', store = {}, blocked = false, buttons = [] } = {}) {
  const attrs = new Map();
  const classes = new Set();
  const props = new Map();
  const listeners = {};
  const root = {
    setAttribute: (k, v) => attrs.set(k, String(v)),
    removeAttribute: (k) => attrs.delete(k),
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    hasAttribute: (k) => attrs.has(k),
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
    style: { setProperty: (k, v) => props.set(k, v) },
  };
  const btn = (b) => {
    const a = { 'data-save': b.id };
    return {
      dataset: { save: b.id, ti: b.ti, k: b.k, s: b.s, b: b.b, w: b.w },
      getAttribute: (k) => (k in a ? a[k] : null),
      setAttribute: (k, v) => (a[k] = String(v)),
      closest: function (sel) { return sel === '[data-save]' ? this : null; },
      attrs: a,
    };
  };
  const btns = buttons.map(btn);
  const document = {
    documentElement: root,
    querySelectorAll: (sel) => (sel === '[data-save]' ? btns : []),
    querySelector: (sel) => (sel === '[data-save][data-ti]' ? btns.find((b) => b.dataset.ti) || null : null),
    addEventListener: (t, f) => (listeners[t] = listeners[t] || []).push(f),
  };
  const ls = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => (store[k] = String(v)),
    removeItem: (k) => delete store[k],
  };
  const win = { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener: (t, f) => (listeners['w:' + t] = listeners['w:' + t] || []).push(f) };
  const ctx = { window: win, document, location: { pathname: path, search: '' }, JSON, Array, Number, String, Date, setTimeout: () => 0 };
  Object.defineProperty(ctx, 'localStorage', { get() { if (blocked) throw new Error('SecurityError'); return ls; } });
  vm.runInNewContext(src, ctx);
  const fire = (t, e = {}) => (listeners[t] || []).forEach((f) => f(e));
  fire('DOMContentLoaded');
  return { attrs, classes, props, store, btns, click: (b) => fire('click', { target: b }), api: win.siteSaved };
}
const ids = (store) => JSON.parse(store.saved || '[]').map((x) => x.id);

// Blocked storage: no throw, nostore class, no API.
let r = run({ blocked: true });
assert.ok(r.classes.has('nostore'));
assert.equal(r.api, undefined);

// Garbage in storage is ignored, and saving over it works.
for (const bad of ['{not json', '"x"', '{"id":"a"}', '[null, 3, {"id": 5}, {"id": ""}]']) {
  r = run({ store: { saved: bad }, buttons: [{ id: 'a', ti: 'A' }] });
  assert.equal(r.attrs.has('data-saved'), false, bad);
  r.click(r.btns[0]);
  assert.deepEqual(ids(r.store), ['a'], bad);
  assert.equal(r.attrs.has('data-saved'), true);
  assert.equal(r.btns[0].attrs['aria-pressed'], 'true');
}

// Newest first; a second click removes; the page's doc state and the list length follow.
const store = {};
for (const id of ['a', 'b', 'c']) {
  r = run({ path: `/items/${id}/read/`, store, buttons: [{ id, ti: id.toUpperCase(), w: '1200' }] });
  r.click(r.btns[0]);
}
assert.deepEqual(ids(store), ['c', 'b', 'a']);
assert.equal(r.props.get('--svn'), '3');
assert.equal(r.attrs.has('data-has-saved'), true);
r = run({ path: '/items/b/', store, buttons: [{ id: 'b', ti: 'B (fixed title)', w: '1200' }] });
assert.equal(r.attrs.has('data-saved'), true);
// The doc page refreshes a saved row's text (titles get corrected) and keeps its time.
const before = JSON.parse(store.saved).find((x) => x.id === 'b');
assert.equal(before.ti, 'B (fixed title)');
r.click(r.btns[0]);
assert.deepEqual(ids(store), ['c', 'a']);
assert.equal(r.attrs.has('data-saved'), false);
assert.equal(r.btns[0].attrs['aria-pressed'], 'false');

// Removing the last one clears the key and the has-saved flag.
r = run({ path: '/items/c/', store, buttons: [{ id: 'c', ti: 'C' }] });
r.click(r.btns[0]);
r = run({ path: '/items/a/', store, buttons: [{ id: 'a', ti: 'A' }] });
r.click(r.btns[0]);
assert.equal('saved' in store, false);
assert.equal(r.attrs.has('data-has-saved'), false);

// A full disk (setItem throws) leaves the state as it was.
const full = run({ store: Object.defineProperty({}, 'saved', { get: () => null, set() { throw new Error('QuotaExceeded'); } }), buttons: [{ id: 'a', ti: 'A' }] });
assert.doesNotThrow(() => full.click(full.btns[0]));
assert.equal(full.attrs.has('data-saved'), false);

console.log('save for later: ok');
