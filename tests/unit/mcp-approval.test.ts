import { expect, it } from 'vitest';
import { mcpApprovalDetails } from '../../src/renderer/state/mcp-approval';
const item = { id: 'call', type: 'mcpToolCall', server: 'aihub', tool: 'gac_kb_search_scoped', status: 'inProgress', arguments: { query: '虚构测试', dataset_ids: ['通用'], token: 'fixture-secret' } };
it('shows real query and scope while redacting secrets', () => {
  expect(mcpApprovalDetails({ serverName: 'aihub' }, [item])).toMatchObject({ title: '检索所选知识库', readOnly: true, arguments: { query: '虚构测试', dataset_ids: ['通用'], token: '已隐藏' } });
});
it('never borrows arguments from a completed, unrelated or ambiguous call', () => {
  expect(mcpApprovalDetails({ serverName: 'other' }, [item]).arguments).toBeNull();
  expect(mcpApprovalDetails({ serverName: 'aihub' }, [{ ...item, status: 'completed' }]).arguments).toBeNull();
  expect(mcpApprovalDetails({ serverName: 'aihub' }, [item, { ...item, id: 'other' }]).arguments).toBeNull();
});
