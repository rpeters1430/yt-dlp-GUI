import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function ReleaseNotesMarkdown({ children }) {
  return React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, children);
}
