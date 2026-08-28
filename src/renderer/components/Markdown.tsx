import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';
import bash from 'shiki/langs/bash.mjs';
import css from 'shiki/langs/css.mjs';
import diff from 'shiki/langs/diff.mjs';
import html from 'shiki/langs/html.mjs';
import javascript from 'shiki/langs/javascript.mjs';
import json from 'shiki/langs/json.mjs';
import jsx from 'shiki/langs/jsx.mjs';
import markdown from 'shiki/langs/markdown.mjs';
import python from 'shiki/langs/python.mjs';
import rust from 'shiki/langs/rust.mjs';
import swift from 'shiki/langs/swift.mjs';
import toml from 'shiki/langs/toml.mjs';
import tsx from 'shiki/langs/tsx.mjs';
import typescript from 'shiki/langs/typescript.mjs';
import yaml from 'shiki/langs/yaml.mjs';
import githubDark from 'shiki/themes/github-dark.mjs';
import githubLight from 'shiki/themes/github-light.mjs';

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [githubLight, githubDark],
    langs: [
      bash,
      css,
      diff,
      html,
      javascript,
      json,
      jsx,
      markdown,
      python,
      rust,
      swift,
      toml,
      tsx,
      typescript,
      yaml,
    ],
    engine: createOnigurumaEngine(import('shiki/wasm')),
  });
  return highlighterPromise;
}

function HighlightedCode({ language, code }: { language: string; code: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getHighlighter()
      .then((highlighter) => {
        const available = highlighter.getLoadedLanguages();
        const lang = available.includes(language as never) ? language : 'text';
        const rendered = highlighter.codeToHtml(code, {
          lang,
          themes: { light: 'github-light', dark: 'github-dark' },
        });
        if (!cancelled) setHtml(rendered);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  if (!html) {
    return (
      <pre className="code-fallback">
        <code>{code}</code>
      </pre>
    );
  }
  return <div className="shiki-wrap" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        pre: ({ children: preChildren }) => <>{preChildren}</>,
        a: ({ node: _node, children: linkChildren, ...props }) => (
          <a {...props} target="_blank" rel="noreferrer">
            {linkChildren}
          </a>
        ),
        code: ({ node: _node, className, children: codeChildren, ...props }) => {
          const language = /language-([^\s]+)/.exec(className ?? '')?.[1];
          const rawCode = String(codeChildren);
          const code = rawCode.replace(/\n$/, '');
          return language ? (
            <HighlightedCode language={language} code={code} />
          ) : rawCode.endsWith('\n') ? (
            <pre className="code-fallback">
              <code {...props}>{code}</code>
            </pre>
          ) : (
            <code className={className} {...props}>
              {codeChildren}
            </code>
          );
        },
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
