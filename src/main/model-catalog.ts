import type {
  RuntimeModelCapabilities,
  RuntimeReasoningEffort,
} from '../shared/types';

const MINIMAX_PROVIDER_ID = 'minimax_token_plan';
const MINIMAX_RESPONSES_BASE_URL = 'https://api.minimaxi.com/v1';

const REASONING_DESCRIPTIONS: Record<RuntimeReasoningEffort, string> = {
  none: '关闭',
  minimal: '最小',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '最大',
  ultra: '极致',
};

interface ModelCatalogProvider {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  capabilities: RuntimeModelCapabilities;
}

export function defaultRuntimeModelCapabilities(
  provider: Pick<ModelCatalogProvider, 'id' | 'baseUrl' | 'model'>,
): RuntimeModelCapabilities {
  if (
    provider.id === MINIMAX_PROVIDER_ID
    && provider.baseUrl === MINIMAX_RESPONSES_BASE_URL
    && provider.model === 'MiniMax-M3'
  ) {
    return {
      contextWindow: 1_000_000,
      imageInput: true,
      supportsReasoning: true,
      reasoningEfforts: ['none', 'high'],
      defaultReasoningEffort: 'high',
      supportsReasoningSummaries: true,
    };
  }

  return {
    contextWindow: 128_000,
    imageInput: modelLooksVisionCapable(provider.model),
    supportsReasoning: true,
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'medium',
    supportsReasoningSummaries: true,
  };
}

export function runtimeModelCatalogJson(provider: ModelCatalogProvider): string {
  const capabilities = provider.capabilities;
  const model = {
    slug: provider.model,
    display_name: provider.model,
    description: provider.name,
    ...(capabilities.supportsReasoning
      ? { default_reasoning_level: capabilities.defaultReasoningEffort }
      : {}),
    supported_reasoning_levels: capabilities.supportsReasoning
      ? capabilities.reasoningEfforts.map((effort) => ({
          effort,
          description: REASONING_DESCRIPTIONS[effort],
        }))
      : [],
    shell_type: 'shell_command',
    visibility: 'list',
    supported_in_api: true,
    priority: 0,
    base_instructions:
      'You are Codex, a coding agent. You and the user share the same workspace and collaborate to achieve the user\'s goals.',
    supports_reasoning_summary_parameter:
      capabilities.supportsReasoning && capabilities.supportsReasoningSummaries,
    default_reasoning_summary:
      capabilities.supportsReasoning && capabilities.supportsReasoningSummaries ? 'auto' : 'none',
    support_verbosity: false,
    truncation_policy: { mode: 'bytes', limit: 10_000 },
    context_window: capabilities.contextWindow,
    max_context_window: capabilities.contextWindow,
    experimental_supported_tools: [],
    input_modalities: capabilities.imageInput ? ['text', 'image'] : ['text'],
  };

  return `${JSON.stringify({ models: [model] }, null, 2)}\n`;
}

function modelLooksVisionCapable(model: string): boolean {
  return /vision|multimodal|omni|(?:^|[-_.])vl(?:[-_.]|$)/i.test(model);
}
