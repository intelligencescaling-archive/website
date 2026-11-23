// Tests the Reddit markdown renderer (src/lib/reddit-md.mjs): what it supports, that hostile markdown never becomes
// live HTML, and that a Reddit post keeps the plain-text reader's pages, #s-N anchors and word offsets.
// Run: npm run test:reddit-md (uses test/fixture-archive, no build needed).
import assert from 'node:assert/strict';

process.env.ARCHIVE_DIR ||= 'test/fixture-archive';
const { renderRun, renderInline, mdPlain, mdPreview, renderMdPart, editorFix } = await import('../src/lib/reddit-md.mjs');
const { loadArchive, readerChapters, readerPages } = await import('../src/lib/archive.mjs');

let failed = 0;
const test = (name, fn) => {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}\n     ${err.message.split('\n').join('\n     ')}`);
  }
};
const html = (src, env = {}) => renderRun(src, 0, { base: 2, ...env });
const has = (out, s) => assert.ok(out.includes(s), `expected ${JSON.stringify(s)} in\n${out}`);
const hasNot = (out, s) => assert.ok(!out.includes(s), `did not expect ${JSON.stringify(s)} in\n${out}`);
const visible = (s) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// ---------------------------------------------------------------- formatting
test('bold, italic, bold-italic, strikethrough', () => {
  const out = html('**b** *i* ***bi*** ~~s~~');
  has(out, '<strong>b</strong>');
  has(out, '<em>i</em>');
  has(out, '<em><strong>bi</strong></em>');
  has(out, '<s>s</s>');
});
test('superscript ^word and ^(words), escaped \\^ stays', () => {
  const out = html('a^b and ^(two words) and \\^no and **2^10**');
  has(out, 'a<sup>b</sup>');
  has(out, '<sup>two words</sup>');
  has(out, '^no');
  has(out, '<strong>2<sup>10</sup></strong>');
});
test('spoilers inline and as a whole line (not a quote)', () => {
  const out = html('a >!secret!< b\n\n>!whole line!<');
  has(out, '<span class="rmd-spoiler" tabindex="0">secret</span>');
  has(out, '<span class="rmd-spoiler" tabindex="0">whole line</span>');
  hasNot(out, '<blockquote');
});
test('headings map to the reader levels; inline heading marks render', () => {
  has(html('# One\n\n### Three\n\nSetext\n---'), '<h2');
  has(html('### Three'), '<h4');
  has(html('Setext\n===='), '<h2');
  assert.equal(renderInline('**Bold** _it_ ##'), '<strong>Bold</strong> <em>it</em>');
});
test('quotes, nested quotes, lists, nested lists, ordered start', () => {
  const out = html('> q\n>> nested\n\n1. a\n   - x\n\ntext\n\n5. five');
  has(out, '<blockquote');
  assert.equal((out.match(/<blockquote/g) || []).length, 2);
  has(out, '<ol');
  has(out, '<ul>');
  has(out, '<ol start="5"');
});
test('inline code, 4-space and fenced code blocks (escaped)', () => {
  const out = html('`x<y`\n\n    def f(x):\n        return x < 1\n\n```js\nfence *no*\n```');
  has(out, '<code>x&lt;y</code>');
  has(out, '<pre data-w="1"><code>def f(x):\n    return x &lt; 1</code></pre>');
  has(out, '<code>fence *no*</code>');
  hasNot(out, 'language-');
});
test('an indented block of prose or a tab-pasted list reads as text, not code', () => {
  const out = html('    He said **this** <b>.\n\n    1.\tOne\n    2.\tTwo');
  has(out, '<div class="ind" data-w="0"><p>He said <strong>this</strong> &lt;b&gt;.</p>');
  has(out, '<li>One</li>');
  hasNot(out, '<pre');
});
test('tables: scroll wrapper, alignment as class (no inline style), th scope', () => {
  const out = html('| a | b |\n|:-:|--:|\n| 1 | 2 |');
  has(out, '<div class="tw" data-w="0" data-n="1"><table>');
  has(out, '<th class="al-c" scope="col">a</th>');
  has(out, '<td class="al-r">2</td>');
  hasNot(out, 'style=');
});
test('horizontal rule, links, bare URLs, u/ and r/ links', () => {
  const out = html('---\n\n[t](https://a.example/x) https://b.example/y u/Some_User r/sub /r/other and/or');
  has(out, '<hr data-w="0">');
  has(out, '<a href="https://a.example/x" rel="nofollow ugc noopener">t</a>');
  has(out, '<a href="https://b.example/y" rel="nofollow ugc noopener">https://b.example/y</a>');
  has(out, '<a href="https://www.reddit.com/u/Some_User/" rel="nofollow ugc noopener">u/Some_User</a>');
  has(out, '<a href="https://www.reddit.com/r/sub/"');
  has(out, '<a href="https://www.reddit.com/r/other/"');
  has(out, 'and/or');
});
test('Reddit escapes and HTML entities; empty filler lines dropped', () => {
  const out = html('\\_ \\* \\[ \\] \\# \\> \\~ \\^ \\\\ &amp; &lt;b&gt;\n\n&#x200B;\n\n&nbsp;\n\nend');
  assert.equal(visible(out).replace(/\s+/g, ' ').trim(), '_ * [ ] # > ~ ^ \\ & <b> end');
  assert.equal((out.match(/<p/g) || []).length, 2);
});
test('hard and soft line breaks', () => {
  const out = html('a  \nb\\\nc\nd');
  assert.equal((out.match(/<br>/g) || []).length, 3);
});
test('editor quirks: escaped bold pairs, escaped heading, split bold runs; censored words untouched', () => {
  assert.equal(editorFix('\\*\\*Bold\\*\\* and \\*one'), '**Bold** and \\*one');
  assert.equal(editorFix('\\## Title'), '## Title');
  assert.equal(editorFix('**The Culprit****s**'), '**The Culprits**');
  assert.equal(editorFix('f****ing'), 'f****ing');
  assert.equal(editorFix('curses**.** and ***:*** here'), 'curses. and : here');
  assert.equal(editorFix('|**Era**|**Key**|'), '|**Era**|**Key**|');
  assert.equal(editorFix('***\\*\\*\\*x'), '***\\*\\*\\*x');
});
test('bare links keep Reddit-escaped underscores as the plain URL', () => {
  has(html('see https://x.example/a?utm\\_source=share now'), 'href="https://x.example/a?utm_source=share"');
});

// ---------------------------------------------------------------- images
const media = new Map([['abcdef123456', { href: 'https://files.example/a.png', px: [640, 480] }]]);
test('a saved image in place of its URL line, as the reader image button', () => {
  const env = { media, used: new Set() };
  const out = html('https://preview.redd.it/abcdef123456.png?width=640&format=png&s=x', env);
  has(out, '<figure class="im md-im" data-w="0"><button type="button" class="zb nat" data-full="https://files.example/a.png"');
  has(out, 'width="640" height="480"');
  hasNot(out, 'preview.redd.it');
});
test('caption links and ![img](id) also show the saved image', () => {
  const env = { media, used: new Set() };
  has(html('[A caption](https://i.redd.it/abcdef123456.png)', env), 'alt="A caption"');
  has(html('![img](abcdef123456)', env), 'class="zb nat"');
});
test('an image that was not saved: nothing for a bare URL, the caption for a captioned one', () => {
  const env = { media, used: new Set() };
  assert.equal(html('https://i.redd.it/missing999zz.jpg', env).trim(), '');
  const out = html('![img](missing999zz "Cap")', env);
  has(out, 'Cap');
  hasNot(out, 'missing999zz');
  assert.equal(html('text\nhttps://preview.redd.it/missing999zz.png?width=1 more', env).includes('redd.it'), false);
});

// ---------------------------------------------------------------- XSS
const EVIL = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '[x](javascript:alert(1))',
  '[x](JaVaScRiPt:alert(1))',
  '[x](data:text/html;base64,PHNjcmlwdD4=)',
  '[x](vbscript:msgbox(1))',
  '![x](javascript:alert(1))',
  '![x](data:image/svg+xml;base64,PHN2Zz4=)',
  '<javascript:alert(1)>',
  '[x](https://ok.example/"onmouseover="alert(1))',
  '<a href="javascript:alert(1)">a</a>',
  '`<script>`',
  '| <script> | b |\n|--|--|\n| <img src=x onerror=alert(1)> | c |',
  '> <iframe src=x></iframe>',
  '>!<svg onload=alert(1)>!<',
  '^(<b onmouseover=alert(1)>x</b>)',
  '[u/x](https://ok.example)<style>body{}</style>',
];
test('hostile markdown never becomes live HTML', () => {
  for (const src of EVIL) {
    for (const out of [html(src, { media, used: new Set() }), renderInline(src), mdPreview(`title\n\n${src}`, []).html]) {
      const tags = [...out.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)];
      for (const [, tag, attrs] of tags) {
        assert.ok(['p', 'a', 'br', 'strong', 'em', 's', 'sup', 'span', 'code', 'pre', 'blockquote', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'hr', 'figure', 'button', 'img'].includes(tag.toLowerCase()), `tag <${tag}> from ${src}`);
        assert.ok(!/\son[a-z]+\s*=/i.test(attrs), `event handler in <${tag}${attrs}> from ${src}`);
        assert.ok(!/\sstyle\s*=/i.test(attrs), `inline style in <${tag}${attrs}> from ${src}`);
        const href = /\s(?:href|src|data-full)="([^"]*)"/i.exec(attrs)?.[1];
        if (href) assert.ok(/^(https:\/\/|http:\/\/|mailto:)/i.test(href) && !/["<>\s]/.test(href), `unsafe url ${href} from ${src}`);
      }
      assert.ok(!/<img[^>]*src="(?!https:\/\/files\.example\/)/.test(out), `foreign image loaded from ${src}`);
    }
  }
});
test('the text of a dropped javascript: link is kept, without brackets', () => {
  assert.equal(visible(html('[click](javascript:alert(1))')).trim(), 'click');
});

// ---------------------------------------------------------------- plain text (search)
test('plain text has the words, not the marks or image links', () => {
  const t = mdPlain('**CONTEXT:** a\\_b [link](https://x.example) ~~s~~ ^(up)\n\nhttps://preview.redd.it/abcdef123456.png?width=1\n\n> q');
  assert.ok(!/[*~\\]|redd\.it/.test(t), t);
  for (const w of ['CONTEXT:', 'a_b', 'link', 's', 'up', 'q']) assert.ok(t.includes(w), `${w} in ${t}`);
});

// ---------------------------------------------------------------- anchor stability
test('a Reddit post keeps the plain reader blocks, offsets, #s-N and pages', () => {
  const { entries } = loadArchive();
  const e = entries.find((x) => x.id === 'evil-reddit-post');
  assert.ok(e, 'fixture entry');
  const asMd = readerChapters(e);
  const asText = readerChapters({ ...e, parts: e.parts.map((p) => ({ ...p, sourceType: 'google-doc' })) });
  const strip = (cs) => cs.map((c) => ({ w: c.w, words: c.words, blocks: c.blocks.map((b) => [b.level, b.text, b.w, b.sid, b.cont]) }));
  assert.deepEqual(strip(asMd), strip(asText));
  const pages = readerPages(asMd);
  assert.deepEqual(pages.map((p) => [p.wordsBefore, p.words]), readerPages(asText).map((p) => [p.wordsBefore, p.words]));
  const st = { imgs: 0, eager: 1, tables: 0 };
  const out = pages.map((p) => p.chapters.map((part) => renderMdPart(asMd[part.i], part, st, { images: asMd[part.i].images })).join('')).join('');
  const heads = asMd[0].blocks.filter((b) => b.sid);
  assert.equal(heads.length, 2);
  for (const b of heads) has(out, `id="s-${b.sid}" data-w="${b.w}"`);
  // Every top-level element has data-w, in order, inside the part's word range.
  const ws = [...out.matchAll(/data-w="(\d+)"/g)].map((m) => Number(m[1]));
  assert.ok(ws.every((w, i) => i === 0 || w >= ws[i - 1]), `offsets in order: ${ws}`);
  assert.ok(ws.every((w) => w >= asMd[0].w && w <= asMd[0].w + asMd[0].words), 'offsets in range');
  // The post title stays plain text; the placed image is in place, the other one after the text.
  has(out, 'Evil &lt;b&gt;Reddit&lt;/b&gt; **title** stays plain');
  assert.equal((out.match(/class="zb nat"/g) || []).length, 2);
  assert.ok(out.indexOf('aaaaaaaaaa') < out.indexOf('id="s-2"'), 'placed image before the second heading');
  assert.ok(out.lastIndexOf('bbbbbbbbbb') > out.indexOf('id="s-2"'), 'unplaced image after the text');
  hasNot(out, 'missing999zz');
});
test('a long paragraph cut into pieces is rendered once, as one paragraph', () => {
  const para = Array.from({ length: 400 }, (_, k) => `**w${k}** word word word word`).join('\n');
  const blocks = [
    { level: 0, text: 'x', src: para, w: 0, cont: true },
    { level: 0, text: 'y', src: '', w: 10, cont: false },
  ];
  const out = renderMdPart({ w: 0, words: 2000, blocks }, { blocks, cont: false }, {}, {});
  assert.equal((out.match(/<p /g) || []).length, 1);
  hasNot(out, '**');
});

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
