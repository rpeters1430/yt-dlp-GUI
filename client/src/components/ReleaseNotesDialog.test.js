import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReleaseNotesMarkdown from './ReleaseNotesMarkdown.js';

test('release notes format Markdown and render raw HTML as text', () => {
  const notes = '## Fixes\n\n- Fixed queue handling\n\n<script>alert("no")</script>';
  const markup = renderToStaticMarkup(React.createElement(ReleaseNotesMarkdown, null, notes));
  assert.match(markup, /<h2>Fixes<\/h2>/);
  assert.match(markup, /<ul>\s*<li>Fixed queue handling<\/li>\s*<\/ul>/);
  assert.match(markup, /&lt;script&gt;alert\(&quot;no&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(markup, /<script>/);
});
