import { mcpApprovalDetails } from '../state/mcp-approval';
import { useMemo, useState } from 'react';
import { AlertTriangle, Check, ShieldCheck, X } from 'lucide-react';
import { useAppStore } from '../state/store';
import type { PendingApproval } from '../state/store';

interface ApprovalCardProps {
  approval: PendingApproval;
  onRespond: (response: unknown) => void;
}

export function ApprovalCard({ approval, onRespond }: ApprovalCardProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [jsonContent, setJsonContent] = useState('{}');
  const brandName = useAppStore((state) => state.branding.name);
  const kind = approvalKind(approval.method);
  const conversation = useAppStore((state) => state.conversation);
  const thread = approval.threadId ? conversation.threads[approval.threadId] : null;
  const turn = approval.turnId && thread ? thread.turns[approval.turnId] : null;
  const mcpDetails = mcpApprovalDetails(approval.params, turn ? Object.values(turn.items) : []);
  const schema = record(approval.params.requestedSchema);
  const hasFormFields = Object.keys(record(schema?.properties) ?? {}).length > 0;
  const questions = Array.isArray(approval.params.questions) ? approval.params.questions : [];
  const permissions = record(approval.params.permissions);

  const title = useMemo(() => {
    switch (kind) {
      case 'command':
        return `${brandName} 请求执行命令`;
      case 'file':
        return `${brandName} 请求修改文件`;
      case 'permissions':
        return `${brandName} 请求额外权限`;
      case 'input':
        return `${brandName} 需要你的回答`;
      case 'mcp':
        return mcpDetails.title;
    }
  }, [kind, brandName, mcpDetails.title]);

  const decline = () => {
    if (kind === 'mcp') onRespond({ action: 'decline', content: null, _meta: null });
    else if (kind === 'input') {
      const empty = Object.fromEntries(
        questions.map((question) => [string(record(question)?.id) ?? '', { answers: [] }]),
      );
      onRespond({ answers: empty });
    } else if (kind === 'permissions') {
      onRespond({ permissions: {}, scope: 'turn' });
    } else onRespond({ decision: approvalDecision(approval.method, false) });
  };

  const accept = (session = false) => {
    if (kind === 'input') {
      onRespond({
        answers: Object.fromEntries(
          questions.map((question) => {
            const id = string(record(question)?.id) ?? '';
            return [id, { answers: answers[id] ? [answers[id]] : [] }];
          }),
        ),
      });
    } else if (kind === 'permissions') {
      onRespond({
        permissions: Object.fromEntries(
          Object.entries(permissions ?? {}).filter(([, value]) => value !== null),
        ),
        scope: session ? 'session' : 'turn',
        ...(session ? {} : { strictAutoReview: true }),
      });
    } else if (kind === 'mcp') {
      try {
        onRespond({ action: 'accept', content: JSON.parse(jsonContent), _meta: null });
      } catch {
        // Keep the invalid JSON visible so the user can correct it.
      }
    } else {
      onRespond({ decision: approvalDecision(approval.method, true, session) });
    }
  };

  return (
    <section className="approval-card" aria-label={title}>
      <div className="approval-heading">
        <span className="approval-icon">
          <ShieldCheck size={16} />
        </span>
        <div>
          <strong>{title}</strong>
          {string(approval.params.reason) && <p>{string(approval.params.reason)}</p>}
        </div>
      </div>

      {kind === 'command' && (
        <div className="approval-detail">
          <code>{string(approval.params.command) ?? '命令详情暂不可用'}</code>
          {string(approval.params.cwd) && <small>{string(approval.params.cwd)}</small>}
        </div>
      )}
      {kind === 'file' && (
        <div className="approval-detail">
          <span>{string(approval.params.grantRoot) ?? '查看上方文件变更后决定是否继续。'}</span>
        </div>
      )}
      {kind === 'permissions' && (
        <div className="approval-detail warning-detail">
          <AlertTriangle size={15} />
          <code>{JSON.stringify(permissions, null, 2)}</code>
        </div>
      )}
      {kind === 'input' && (
        <div className="approval-questions">
          {questions.map((rawQuestion, index) => {
            const question = record(rawQuestion);
            const id = string(question?.id) ?? String(index);
            const options = Array.isArray(question?.options) ? question.options : [];
            return (
              <label key={id}>
                <span>{string(question?.header) ?? '问题'}</span>
                <strong>{string(question?.question) ?? ''}</strong>
                {options.length > 0 ? (
                  <select
                    value={answers[id] ?? ''}
                    onChange={(event) => setAnswers({ ...answers, [id]: event.target.value })}
                  >
                    <option value="">请选择</option>
                    {options.map((rawOption, optionIndex) => {
                      const option = record(rawOption);
                      const label = string(option?.label) ?? String(optionIndex + 1);
                      return (
                        <option key={label} value={label}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                ) : (
                  <input
                    type={question?.isSecret === true ? 'password' : 'text'}
                    value={answers[id] ?? ''}
                    onChange={(event) => setAnswers({ ...answers, [id]: event.target.value })}
                  />
                )}
              </label>
            );
          })}
        </div>
      )}
      {kind === 'mcp' && (
        <div className="approval-questions">
          <p>{string(approval.params.message) ?? 'MCP 服务请求结构化输入。'}</p>
          <strong>{mcpDetails.title}{mcpDetails.readOnly ? ' · 只读' : ''}</strong>
          {mcpDetails.arguments == null ? <p>服务未提供可唯一关联的工具参数，请核对服务说明；无法确认范围时请拒绝。</p> : <pre aria-label="本次工具参数">{JSON.stringify(mcpDetails.arguments, null, 2)}</pre>}
          {hasFormFields && <label>服务请求的补充信息<textarea
            aria-label="MCP JSON 内容"
            value={jsonContent}
            onChange={(event) => setJsonContent(event.target.value)}
          /></label>}
        </div>
      )}

      <div className="approval-actions">
        <button className="button ghost danger" onClick={decline}>
          <X size={14} /> 拒绝
        </button>
        {(kind === 'command' || kind === 'file' || kind === 'permissions') && (
          <button className="button secondary" onClick={() => accept(true)}>
            本次对话允许
          </button>
        )}
        <button className="button primary" onClick={() => accept(false)}>
          <Check size={14} /> 仅允许此项
        </button>
      </div>
    </section>
  );
}

function approvalKind(method: string): 'command' | 'file' | 'permissions' | 'input' | 'mcp' {
  if (method.includes('command') || method === 'execCommandApproval') return 'command';
  if (method.includes('fileChange') || method === 'applyPatchApproval') return 'file';
  if (method.includes('permissions')) return 'permissions';
  if (method.includes('requestUserInput')) return 'input';
  return 'mcp';
}

function approvalDecision(method: string, accepted: boolean, session = false): unknown {
  if (method === 'execCommandApproval' || method === 'applyPatchApproval') {
    if (!accepted) return { denied: { rejection: '用户拒绝了该操作' } };
    return session ? 'approved_for_session' : 'approved';
  }
  if (!accepted) return 'decline';
  return session ? 'acceptForSession' : 'accept';
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function string(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
