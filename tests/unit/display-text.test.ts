import { describe, expect, it } from 'vitest';
import { threadDisplayTitle, userVisibleText } from '../../src/shared/display-text';

describe('user-facing conversation text', () => {
  it('cleans old titles whose context is flattened or truncated', () => {
    expect(threadDisplayTitle({ name: '写 hello.py <whale_brand_identity> 内部提示词' })).toBe('写 hello.py');
    expect(threadDisplayTitle({ preview: '你好 <whale_brand_' })).toBe('你好');
    expect(threadDisplayTitle({ name: '<whale_brand_identity>内部</whale_brand_identity>', preview: '真实任务' })).toBe('真实任务');
  });

  it('strips all app contexts while preserving ordinary user markup and following text', () => {
    const tags = ['brand_identity', 'file_attachments', 'explicit_tools', 'explicit_dynamic_tools', 'plugin_context'];
    const contexts = tags.map((tag) => `<whale_${tag}>内部\n上下文</whale_${tag}>`).join('\n');
    expect(userVisibleText(`处理 <div>内容</div>\n${contexts}\n然后总结`)).toBe('处理 <div>内容</div>\n\n\n\n\n\n然后总结');
    expect(userVisibleText('解释 <whale_custom> 标签')).toBe('解释 <whale_custom> 标签');
  });
});
