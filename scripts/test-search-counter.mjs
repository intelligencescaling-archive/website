// Checks the search counter's privacy rules (src/scripts/query-clean.js). Run: npm run test:counter
import assert from 'node:assert/strict';
import { cleanQuery, bucketOf, cleanFilters } from '../src/scripts/query-clean.js';

const eq = (a, b) => assert.equal(a, b);
eq(cleanQuery('  Death   NOTE '), 'death note');
eq(cleanQuery('x'), null); // under 2 chars
eq(cleanQuery(' a '), null);
eq(cleanQuery('ab'), 'ab');
eq(cleanQuery('a'.repeat(100)), 'a'.repeat(60));
eq(cleanQuery('mail me at bob@example.com'), null);
eq(cleanQuery('@someone'), null);
eq(cleanQuery('call 5551234567'), null);
eq(cleanQuery('call 555 123 4567'), null);
eq(cleanQuery('chapter 12345'), 'chapter 12345'); // 5 digits is fine
eq(cleanQuery('https://docs.google.com/document/d/abc'), null);
eq(cleanQuery('www.example.org'), null);
eq(cleanQuery('docs.google.com'), null);
eq(cleanQuery('naruto vs sasuke'), 'naruto vs sasuke');
eq(cleanQuery(null), null);
eq(cleanQuery({}), null);
eq(cleanQuery('tab\tand\nnewline'), 'tab and newline');
eq(bucketOf(0), '0');
eq(bucketOf(1), '1-5');
eq(bucketOf(5), '1-5');
eq(bucketOf(6), '6+');
eq(cleanFilters(['Series=Naruto', 'Category=Stories', 'Series=Naruto']), 'Category=Stories|Series=Naruto');
eq(cleanFilters('nope'), '');
eq(cleanFilters(Array(20).fill(0).map((_, i) => 'F' + i)).split('|').length, 8);
console.log('search counter: ok');
