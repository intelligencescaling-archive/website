// Submit page: shows the fields for the chosen kind, checks the link, warns when it's already archived,
// and posts JSON to /api/submit. The server checks everything again.

import { removedData, removedHash } from './removed.js';

const GOOGLE = /^https:\/\/(docs|drive)\.google\.com\//i;
const REDDIT = /^https:\/\/((www|old|new|m|np)\.)?reddit\.com\/|^https:\/\/redd\.it\//i;
const ITEM = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function googleId(url) {
  const m = /\/(?:document|presentation|spreadsheets|file)\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,})/.exec(url) || /[?&]id=([A-Za-z0-9_-]{20,})/.exec(url);
  return m ? m[1] : null;
}
export function redditId(url) {
  const m = /reddit\.com\/(?:r\/[^/]+\/)?comments\/([a-z0-9]{5,10})/i.exec(url) || /redd\.it\/([a-z0-9]{5,10})/i.exec(url);
  return m ? m[1].toLowerCase() : null;
}
/** An item id from "https://intelscaling.com/items/<id>/", "/items/<id>" or a bare id; else null. */
export function itemId(text) {
  const t = text.trim();
  const m = /\/items\/([a-z0-9-]+)\/?/.exec(t);
  const id = m ? m[1] : t;
  return ITEM.test(id) && id.length <= 80 ? id : null;
}

export function initSubmit() {
  const form = document.getElementById('submit-form');
  if (!form || form.hidden) return;
  const result = document.getElementById('result');
  const send = document.getElementById('send');
  const sets = [...form.querySelectorAll('fieldset[data-kind]')];
  const $ = (id) => document.getElementById(id);
  let ids = null;
  let confirmDuplicate = false;
  let needsNewToken = false;

  const kind = () => form.querySelector('input[name="kind"]:checked').value;
  function showKind() {
    const k = kind();
    for (const s of sets) s.hidden = !s.dataset.kind.split(' ').includes(k);
    form.querySelectorAll('.submit-result.at').forEach((x) => x.remove());
    result.hidden = true;
    confirmDuplicate = false;
  }
  form.addEventListener('change', (ev) => { if (ev.target.name === 'kind') showKind(); });

  // ?fix=<id> or ?remove=<id> (links from item pages and the removal page)
  const params = new URLSearchParams(location.search);
  for (const k of ['fix', 'remove']) {
    const id = params.get(k);
    if (id !== null) {
      form.querySelector(`input[name="kind"][value="${k}"]`).checked = true;
      if (itemId(id)) $('item').value = `https://intelscaling.com/items/${itemId(id)}/`;
    }
  }
  showKind();

  function say(html, tone) {
    result.innerHTML = html;
    result.className = `submit-result ${tone || ''}`;
    result.hidden = false;
  }
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  async function alreadyArchived(url) {
    try {
      ids ||= await fetch('/archived-ids.json').then((r) => (r.ok ? r.json() : { g: {}, r: {} }));
    } catch {
      return null;
    }
    const g = googleId(url);
    const r = redditId(url);
    return (g && ids.g[g]) || (r && ids.r[r]) || null;
  }

  /** Work whose author asked us not to host it: a note under the field it is about, focus on that field. */
  const clearBlocked = () => form.querySelectorAll('.submit-result.at').forEach((x) => x.remove());
  function blockedAt(field, text) {
    const box = document.createElement('div');
    box.className = 'submit-result warn at';
    box.setAttribute('role', 'alert');
    const a = document.createElement('a');
    a.href = '/removal/';
    a.textContent = 'Contact us';
    box.append(text + ' ', a, '.');
    $(field).closest('.field').append(box);
    result.hidden = true;
    $(field).focus();
  }
  async function askedNotTo(url, author) {
    const d = await removedData();
    if (!d) return false;
    const g = googleId(url);
    const r = redditId(url);
    const p = /\/d\/e\/(2PACX-[A-Za-z0-9_-]+)/.exec(url);
    const h = p ? await removedHash('p', p[1]) : g ? await removedHash('g', g) : r ? await removedHash('r', r) : null;
    if (h && d.links.includes(h)) {
      blockedAt('url', 'We can’t add this one, at its author’s request. Think that’s a mistake?');
      return true;
    }
    const name = author.trim().replace(/^\/?u\//i, '').replace(/^@/, '').toLowerCase();
    if (name && d.blocked.includes(name)) {
      blockedAt('author', 'We can’t add work credited to this name, at the author’s request. Wrong person, or is this you?');
      return true;
    }
    return false;
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    clearBlocked();
    const k = kind();
    const data = Object.fromEntries(new FormData(form));
    const body = { kind: k, note: data.note, by: data.by, token: data['cf-turnstile-response'] || '' };

    if (k === 'add') {
      const url = data.url.trim();
      if (!url) return say('Paste the link to the doc or post.', 'bad'), $('url').focus();
      if (!GOOGLE.test(url) && !REDDIT.test(url))
        return say('That link isn\'t a Google Doc, a Google Drive file or a Reddit post. Those are the only links we can archive.', 'bad'), $('url').focus();
      if (await askedNotTo(url, data.author || '')) return;
      if (!confirmDuplicate) {
        const have = await alreadyArchived(url);
        if (have) {
          confirmDuplicate = true;
          return say(`Already archived: <a href="/items/${esc(have)}/">see it here</a>. If this is a different or newer version, press Send again.`, 'warn');
        }
      }
      Object.assign(body, { url, what: data.what, title: data.title, series: data.series, characters: data.characters, author: data.author });
    } else {
      const item = itemId(data.item || '');
      if (!item && !data.item.trim()) return say('Paste the entry\'s link on this site, or its title.', 'bad'), $('item').focus();
      body.item = item || data.item.trim();
      if (k === 'fix') {
        if (!data.value.trim() && !data.note.trim()) return say('Say what it should be.', 'bad'), $('value').focus();
        Object.assign(body, { field: data.field, value: data.value });
      } else {
        body.wish = data.wish;
      }
    }
    if (!body.token) return say('One moment: the spam check hasn\'t finished. Try again in a few seconds.', 'warn');

    send.disabled = true;
    send.textContent = 'Sending…';
    try {
      const res = await fetch('/api/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok) {
        form.reset();
        showKind();
        say(`<strong>Thanks, it's in the queue</strong> as number ${Number(j.number) || '?'}. Quote that number if you ask about it later.`, 'ok');
        // A spam-check token works once. Get a new one only when the person starts another submission, so the
        // check doesn't pop up again right under the "thanks" message.
        needsNewToken = true;
      } else {
        say(esc(j.error || 'Something went wrong on our side. Please try again later.'), 'bad');
        window.turnstile?.reset();
      }
    } catch {
      say('Couldn\'t reach the server. Check your connection and try again.', 'bad');
      window.turnstile?.reset();
    } finally {
      send.disabled = false;
      send.textContent = 'Send';
      confirmDuplicate = false;
    }
  });
  form.addEventListener('input', () => {
    if (!needsNewToken) return;
    needsNewToken = false;
    window.turnstile?.reset();
  });
}
