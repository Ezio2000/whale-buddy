import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import type { OfficeDraft } from './office-artifact';

export interface RichTextRun {
  text: string;
  bold?: boolean;
  italics?: boolean;
  code?: boolean;
}

export interface RichTextBlock {
  kind: 'heading' | 'paragraph' | 'bullet' | 'number' | 'quote' | 'rule';
  level?: number;
  runs: RichTextRun[];
}

const HTML_PATTERN = /^\s*(?:<!doctype\s+html|<html|<(?:article|section|main|h[1-6]|p|ul|ol|blockquote|div)\b)/i;

export function parseRichText(content: string): RichTextBlock[] {
  return HTML_PATTERN.test(content) ? parseHtml(content) : parseMarkdown(content);
}

export async function renderDocxArtifact(draft: OfficeDraft): Promise<Uint8Array> {
  if (draft.format !== 'docx') throw new Error('Word 成果格式无效');
  const blocks = parseRichText(draft.content);
  const first = blocks[0];
  const normalizedTitle = draft.title.replace(/\.docx$/i, '').trim();
  const body = first?.kind === 'heading' && plainText(first.runs).trim() === normalizedTitle ? blocks.slice(1) : blocks;
  const document = new Document({
    creator: 'Whale Buddy',
    title: normalizedTitle,
    description: draft.summary,
    numbering: {
      config: [{
        reference: 'office-numbering',
        levels: [{
          level: 0,
          format: LevelFormat.DECIMAL,
          text: '%1.',
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      }],
    },
    styles: {
      default: {
        document: { run: { font: 'Aptos', size: 22, color: '25303D' }, paragraph: { spacing: { after: 160, line: 320 } } },
        heading1: { run: { font: 'Aptos Display', size: 32, bold: true, color: '2F6699' }, paragraph: { spacing: { before: 300, after: 140 } } },
        heading2: { run: { font: 'Aptos Display', size: 27, bold: true, color: '315B7D' }, paragraph: { spacing: { before: 240, after: 120 } } },
        heading3: { run: { font: 'Aptos Display', size: 24, bold: true, color: '3B4B59' }, paragraph: { spacing: { before: 200, after: 100 } } },
      },
    },
    sections: [{
      properties: { page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
      children: [
        new Paragraph({
          heading: HeadingLevel.TITLE,
          spacing: { after: 300 },
          children: [new TextRun({ text: normalizedTitle, bold: true, size: 40, color: '255F8F' })],
        }),
        ...(draft.summary.trim() && draft.summary.trim() !== normalizedTitle
          ? [new Paragraph({
              spacing: { after: 320 },
              border: { bottom: { style: BorderStyle.SINGLE, color: 'C9D7E3', size: 8, space: 10 } },
              children: [new TextRun({ text: draft.summary.trim(), italics: true, color: '5D6B78' })],
            })]
          : []),
        ...body.map(blockToParagraph),
      ],
    }],
  });
  const base64 = await Packer.toBase64String(document);
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function blockToParagraph(block: RichTextBlock): Paragraph {
  const children = block.runs.map((run) => new TextRun({
    text: run.text,
    bold: run.bold,
    italics: run.italics,
    font: run.code ? 'Menlo' : undefined,
    color: run.code ? '8B3E2F' : undefined,
    shading: run.code ? { fill: 'F3F5F7' } : undefined,
  }));
  if (block.kind === 'heading') {
    const heading = block.level === 1 ? HeadingLevel.HEADING_1 : block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
    return new Paragraph({ heading, children });
  }
  if (block.kind === 'bullet') return new Paragraph({ bullet: { level: 0 }, children });
  if (block.kind === 'number') return new Paragraph({ numbering: { reference: 'office-numbering', level: 0 }, children });
  if (block.kind === 'quote') {
    return new Paragraph({ indent: { left: 480 }, border: { left: { style: BorderStyle.SINGLE, color: '6A9CC5', size: 18, space: 10 } }, children });
  }
  if (block.kind === 'rule') {
    return new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, color: 'B8C5D0', size: 8, space: 8 } }, children: [] });
  }
  return new Paragraph({ children });
}

function parseMarkdown(content: string): RichTextBlock[] {
  const blocks: RichTextBlock[] = [];
  for (const rawLine of content.replace(/\r/g, '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^(?:-{3,}|_{3,}|\*{3,})$/.test(line)) { blocks.push({ kind: 'rule', runs: [] }); continue; }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { blocks.push({ kind: 'heading', level: Math.min(3, heading[1].length), runs: parseInlineMarkdown(heading[2]) }); continue; }
    const bullet = /^[-+*]\s+(.+)$/.exec(line);
    if (bullet) { blocks.push({ kind: 'bullet', runs: parseInlineMarkdown(bullet[1]) }); continue; }
    const number = /^\d+[.)]\s+(.+)$/.exec(line);
    if (number) { blocks.push({ kind: 'number', runs: parseInlineMarkdown(number[1]) }); continue; }
    const quote = /^>\s*(.+)$/.exec(line);
    if (quote) { blocks.push({ kind: 'quote', runs: parseInlineMarkdown(quote[1]) }); continue; }
    blocks.push({ kind: 'paragraph', runs: parseInlineMarkdown(line) });
  }
  return blocks;
}

function parseInlineMarkdown(value: string): RichTextRun[] {
  const runs: RichTextRun[] = [];
  const token = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|_[^_]+_)/g;
  let offset = 0;
  for (const match of value.matchAll(token)) {
    if (match.index! > offset) runs.push({ text: value.slice(offset, match.index) });
    const raw = match[0];
    if (raw.startsWith('**') || raw.startsWith('__')) runs.push({ text: raw.slice(2, -2), bold: true });
    else if (raw.startsWith('`')) runs.push({ text: raw.slice(1, -1), code: true });
    else runs.push({ text: raw.slice(1, -1), italics: true });
    offset = match.index! + raw.length;
  }
  if (offset < value.length) runs.push({ text: value.slice(offset) });
  return runs.length ? runs : [{ text: value }];
}

function parseHtml(content: string): RichTextBlock[] {
  const parsed = new DOMParser().parseFromString(content, 'text/html');
  const blocks: RichTextBlock[] = [];
  const visit = (element: Element) => {
    const tag = element.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) blocks.push({ kind: 'heading', level: Math.min(3, Number(tag[1])), runs: inlineFromElement(element) });
    else if (tag === 'p') blocks.push({ kind: 'paragraph', runs: inlineFromElement(element) });
    else if (tag === 'blockquote') blocks.push({ kind: 'quote', runs: inlineFromElement(element) });
    else if (tag === 'hr') blocks.push({ kind: 'rule', runs: [] });
    else if (tag === 'ul' || tag === 'ol') {
      for (const item of Array.from(element.children).filter((child) => child.tagName.toLowerCase() === 'li')) {
        blocks.push({ kind: tag === 'ul' ? 'bullet' : 'number', runs: inlineFromElement(item) });
      }
    } else {
      const children = Array.from(element.children);
      if (children.length) children.forEach(visit);
      else if (element.textContent?.trim()) blocks.push({ kind: 'paragraph', runs: inlineFromElement(element) });
    }
  };
  Array.from(parsed.body.children).forEach(visit);
  return blocks;
}

function inlineFromElement(element: Element): RichTextRun[] {
  const runs: RichTextRun[] = [];
  const walk = (node: Node, inherited: Omit<RichTextRun, 'text'> = {}) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.replace(/\s+/g, ' ') ?? '';
      if (text) runs.push({ text, ...inherited });
      return;
    }
    if (!(node instanceof Element)) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'br') { runs.push({ text: '\n', ...inherited }); return; }
    const style = {
      ...inherited,
      ...(tag === 'strong' || tag === 'b' ? { bold: true } : {}),
      ...(tag === 'em' || tag === 'i' ? { italics: true } : {}),
      ...(tag === 'code' ? { code: true } : {}),
    };
    node.childNodes.forEach((child) => walk(child, style));
  };
  element.childNodes.forEach((child) => walk(child));
  return runs.length ? runs : [{ text: element.textContent?.trim() ?? '' }];
}

function plainText(runs: RichTextRun[]) { return runs.map((run) => run.text).join(''); }
