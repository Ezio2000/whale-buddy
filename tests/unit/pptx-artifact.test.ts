import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { extractPptxText, renderPptxArtifact } from '../../marketplaces/office/plugins/whale-office-assistant/ui-src/src/pptx-artifact';

const xml = (tag: string, value: string) => `<root xmlns:a="urn:a" xmlns:c="urn:c"><${tag}>${value}</${tag}></root>`;

describe('office PowerPoint artifacts', () => {
  it('extracts slides in numeric order plus notes, charts, and SmartArt', async () => {
    const zip = new JSZip();
    zip.file('ppt/slides/slide10.xml', xml('a:t', '第十页'));
    zip.file('ppt/slides/slide2.xml', xml('a:t', '第二页'));
    zip.file('ppt/slides/slide1.xml', xml('a:t', '第一页'));
    zip.file('ppt/notesSlides/notesSlide2.xml', xml('a:t', '第二页备注'));
    zip.file('ppt/charts/chart1.xml', xml('c:v', '42'));
    zip.file('ppt/diagrams/data1.xml', xml('a:t', '智能图示文字'));
    const extracted = await extractPptxText(await zip.generateAsync({ type: 'uint8array' }));
    expect(extracted.indexOf('第一页')).toBeLessThan(extracted.indexOf('第二页'));
    expect(extracted.indexOf('第二页')).toBeLessThan(extracted.indexOf('第十页'));
    expect(extracted).toContain('第二页备注');
    expect(extracted).toContain('# 图表 1\n42');
    expect(extracted).toContain('智能图示文字');
  });

  it('renders an editable presentation with slides and speaker notes', async () => {
    const bytes = await renderPptxArtifact({
      taskId: 'task-pptx', title: '季度复盘.pptx', format: 'pptx', summary: '季度经营复盘。', content: '摘要',
      slides: [
        { title: '季度复盘', body: '2026 Q3' },
        { title: '关键进展', bullets: ['收入增长 18%', '交付周期缩短 12%'], notes: '强调续约。' },
      ],
    });
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file('ppt/presentation.xml')).toBeTruthy();
    expect(Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))).toHaveLength(2);
    expect(await zip.file('ppt/slides/slide2.xml')!.async('text')).toContain('收入增长 18%');
    expect(Object.keys(zip.files).some((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name))).toBe(true);
  });
});
