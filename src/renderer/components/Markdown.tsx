import { createContext, useContext, useEffect, useState } from 'react';
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

export const MarkdownTurnContext = createContext<string | null>(null);

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
  const turnId = useContext(MarkdownTurnContext);
  const [preview, setPreview] = useState<{ path: string; content?: string; error?: string } | null>(null);
  return (
    <>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        pre: ({ children: preChildren }) => <>{preChildren}</>,
        a: ({ node: _node, children: linkChildren, ...props }) => (
          <a {...props} target="_blank" rel="noreferrer" onClick={(event) => {
            const href = props.href;
            if (!href || href.startsWith('#') || /^(https?:|mailto:)/i.test(href)) return;
            event.preventDefault();
            if (!turnId) { setPreview({ path: href, error: '此消息没有任务工作目录，无法预览文件。' }); return; }
            try {
              const filePath = decodeURIComponent((href.toLowerCase().startsWith('file://') ? href.slice(7) : href).split(/[?#]/)[0]);
              setPreview({ path: filePath });
              void window.whale.turns.filePreview({ turnId, path: filePath })
                .then((content) => setPreview((current) => current?.path === filePath ? { path: filePath, content } : current))
                .catch((error) => setPreview((current) => current?.path === filePath ? { path: filePath, error: filePreviewError(error) } : current));
            } catch { setPreview({ path: href, error: '文件链接格式无效。' }); }
          }}>
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
    {preview && <section className="chat-file-preview" aria-label="聊天文件预览"><header><strong>{preview.path}</strong><button aria-label="关闭文件预览" onClick={() => setPreview(null)}>关闭</button></header>{preview.error ? <p role="alert">{preview.error}</p> : preview.content === undefined ? <p>正在读取文件…</p> : <pre>{preview.content}</pre>}</section>}
    </>
  );
}

function filePreviewError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('ENOENT')) return '找不到这个文件，可能已移动或删除。请检查链接或在项目中查找。';
  if (/EACCES|EPERM/.test(message)) return '无法读取这个文件，请检查文件访问权限。';
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}
