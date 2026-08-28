export function codexFailureNotice(error: unknown, fallback: string): string {
  const value = record(error);
  const message = string(value?.message) ?? fallback;
  const info = value?.codexErrorInfo;
  if (info === 'usageLimitExceeded' || info === 'sessionBudgetExceeded') {
    return `额度不足：${message}`;
  }
  if (info === 'serverOverloaded') return `服务繁忙：${message}`;
  if (info === 'unauthorized') return `登录已失效：${message}`;
  return message;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function string(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
