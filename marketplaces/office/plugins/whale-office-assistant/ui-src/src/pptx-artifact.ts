import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import type { OfficeDraft } from './office-artifact';

export async function extractPptxText(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const sections: string[] = [];
  for (const entry of orderedXmlEntries(zip, /^ppt\/slides\/slide(\d+)\.xml$/)) {
    sections.push(`# 幻灯片 ${entry.number}\n${xmlText(await entry.file.async('text'))}`);
  }
  for (const entry of orderedXmlEntries(zip, /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/)) {
    const text = xmlText(await entry.file.async('text'));
    if (text) sections.push(`# 演讲者备注 ${entry.number}\n${text}`);
  }
  for (const entry of orderedXmlEntries(zip, /^ppt\/charts\/chart(\d+)\.xml$/)) {
    const text = xmlText(await entry.file.async('text'));
    if (text) sections.push(`# 图表 ${entry.number}\n${text}`);
  }
  for (const entry of orderedXmlEntries(zip, /^ppt\/diagrams\/data(\d+)\.xml$/)) {
    const text = xmlText(await entry.file.async('text'));
    if (text) sections.push(`# SmartArt ${entry.number}\n${text}`);
  }
  return sections.join('\n\n').slice(0, 200_000);
}

export async function renderPptxArtifact(draft: OfficeDraft): Promise<Uint8Array> {
  if (draft.format !== 'pptx' || !draft.slides?.length) throw new Error('PowerPoint 成果缺少有效 slides');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Whale Buddy';
  pptx.company = 'Whale Buddy';
  pptx.subject = draft.summary;
  pptx.title = draft.title.replace(/\.pptx$/i, '');
  pptx.theme = { headFontFace: 'Aptos Display', bodyFontFace: 'Aptos' };

  draft.slides.forEach((item, index) => {
    const slide = pptx.addSlide();
    slide.background = { color: index === 0 ? 'EEF4F8' : 'FFFFFF' };
    const titleSize = index === 0 ? 32 : 27;
    slide.addText(item.title, {
      x: 0.72, y: index === 0 ? 1.25 : 0.55, w: 11.85, h: index === 0 ? 1.0 : 0.65,
      fontFace: 'Aptos Display', fontSize: titleSize, bold: true, color: '285F8D',
      margin: 0, breakLine: false, fit: 'shrink',
    });
    let y = index === 0 ? 2.55 : 1.45;
    if (item.body) {
      slide.addText(item.body, {
        x: 0.78, y, w: 11.65, h: item.bullets?.length ? 1.15 : 4.7,
        fontFace: 'Aptos', fontSize: index === 0 ? 20 : 18, color: '3C4A57',
        margin: 0, breakLine: false, valign: 'top', fit: 'shrink',
      });
      y += item.bullets?.length ? 1.45 : 0;
    }
    if (item.bullets?.length) {
      const height = Math.min(4.9, Math.max(1.1, item.bullets.length * 0.57));
      slide.addText(item.bullets.map((bullet) => ({ text: bullet, options: { bullet: { indent: 18 }, breakLine: true } })), {
        x: 0.9, y, w: 11.2, h: height, fontFace: 'Aptos', fontSize: 19,
        color: '283746', margin: 0, breakLine: false, valign: 'top', fit: 'shrink', paraSpaceAfter: 10,
      });
    }
    slide.addText(`${index + 1} / ${draft.slides!.length}`, {
      x: 11.45, y: 7.05, w: 1.05, h: 0.18, fontSize: 8, color: '80909F', align: 'right', margin: 0,
    });
    if (item.notes) slide.addNotes(item.notes);
  });
  const result = await pptx.write({ outputType: 'arraybuffer' });
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  if (result instanceof Uint8Array) return result;
  if (result instanceof Blob) return new Uint8Array(await result.arrayBuffer());
  throw new Error('PowerPoint 文件生成失败');
}

function orderedXmlEntries(zip: JSZip, pattern: RegExp) {
  return Object.entries(zip.files)
    .map(([name, file]) => {
      const match = pattern.exec(name);
      return match ? { number: Number(match[1]), file } : null;
    })
    .filter((entry): entry is { number: number; file: JSZip.JSZipObject } => Boolean(entry))
    .sort((left, right) => left.number - right.number);
}

function xmlText(xml: string): string {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) return '';
  const values = Array.from(document.getElementsByTagName('*'))
    .filter((node) => ['t', 'v', 'f'].includes(node.localName))
    .map((node) => node.textContent?.trim() ?? '')
    .filter(Boolean);
  return values.join(' ').replace(/\s+/g, ' ').trim();
}
