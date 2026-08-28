export const MINIMAX_M3_MODEL_CATALOG = {
  models: [
    {
      slug: 'MiniMax-M3',
      display_name: 'MiniMax-M3',
      description: 'MiniMax',
      default_reasoning_level: 'high',
      supported_reasoning_levels: [
        { effort: 'none', description: 'Think-Off' },
        { effort: 'high', description: 'Deep' },
      ],
      shell_type: 'shell_command',
      visibility: 'list',
      supported_in_api: true,
      priority: 0,
      base_instructions:
        'You are Codex, a coding agent based on MiniMax-M3. You and the user share the same workspace and collaborate to achieve the user\'s goals.',
      supports_reasoning_summaries: true,
      supports_reasoning_summary_parameter: true,
      default_reasoning_summary: 'none',
      support_verbosity: false,
      truncation_policy: { mode: 'bytes', limit: 10_000 },
      supports_parallel_tool_calls: true,
      context_window: 1_000_000,
      max_context_window: 1_000_000,
      experimental_supported_tools: [],
      input_modalities: ['text', 'image'],
    },
  ],
} as const;

export const MINIMAX_M3_MODEL_CATALOG_JSON =
  `${JSON.stringify(MINIMAX_M3_MODEL_CATALOG, null, 2)}\n`;
