import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/http/markdown.ts';

/**
 * ⚖️ The guide carries screenshots (Peter, 09-08: "are you able to mock screen
 * displays to include?"). Same-origin only: an off-site image would break the
 * privacy line — FlightDeck talks to nothing but the Core and the browsers on
 * the network — and the page's own policy would refuse it anyway.
 */
test('an image is emitted only for a same-origin path', () => {
  const html = renderMarkdown('![The Wall](/assets/screens/wall.png)');
  assert.match(html, /<img src="\/assets\/screens\/wall\.png" alt="The Wall" loading="lazy">/);

  for (const bad of [
    '![x](https://example.com/a.png)',
    '![x](/assets/../../etc/passwd)',
    '![x](/assets/thing.js)',
    '![x](javascript:alert(1))',
  ]) {
    assert.doesNotMatch(renderMarkdown(bad), /<img/, bad + ' must not become an image');
  }
});

test('an image does not leave a stray bang, and links still work beside it', () => {
  const html = renderMarkdown('![shot](/assets/screens/puck.png) and [the Wall](/) after');
  assert.doesNotMatch(html, /!&lt;img|!<img/);
  assert.match(html, /<a href="\/">the Wall<\/a>/);
});
