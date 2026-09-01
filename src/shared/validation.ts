import { z } from 'zod';
import type { DesktopPlatform } from '../platform';
import {
  currentSandboxPlatformStrategy,
  sandboxPlatformStrategyFor,
} from '../platform/sandbox';
import type { JsonValue } from './types';

export const idSchema = z.string().min(1).max(256);
export const requestIdSchema = z.union([z.string().min(1), z.number().int().nonnegative()]);

export const authSettingsSchema = z.object({
  issuer: z.string().trim().url().max(2_048).refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  }, 'Casdoor 地址必须使用 HTTP(S)'),
}).strict();

export const artifactCreateSchema = z.object({
  name: z.string().trim().min(1).max(256),
  format: z.enum(['html', 'docx', 'xlsx', 'pptx']),
  dataBase64: z.string().min(1).max(70_000_000),
  threadId: idSchema,
  taskId: idSchema,
  pluginId: idSchema.nullable().optional(),
  turnId: idSchema.nullable().optional(),
}).strict();
export const artifactIdSchema = z.object({ id: idSchema }).strict();
export const artifactListSchema = z.object({ threadId: idSchema.optional() }).strict();

export function absolutePathSchemaFor(platform: DesktopPlatform) {
  return z
    .string()
    .min(1)
    .max(16_384)
    .refine(sandboxPlatformStrategyFor(platform).isAbsolutePath, '必须是绝对路径');
}

export const absolutePathSchema = absolutePathSchemaFor(currentSandboxPlatformStrategy().id);

export const runtimeBrandingInputSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    iconPath: z.union([absolutePathSchema, z.literal('')]),
  })
  .strict();

export const projectRemoveSchema = z.object({ projectId: idSchema }).strict();

export const threadListSchema = z
  .object({
    cursor: z.string().nullable().optional(),
    archived: z.boolean().optional(),
    cwd: absolutePathSchema.optional(),
  })
  .strict();

export const policySchema = z.enum(['untrusted', 'on-request', 'never']);
export const sandboxModeSchema = z.enum(['read-only', 'workspace-write', 'danger-full-access']);
export const attachmentSchema = z
  .object({
    id: idSchema.optional(),
    name: z.string().trim().min(1).max(512),
    path: absolutePathSchema,
    kind: z.enum(['image', 'file']),
    mimeType: z.string().max(256).optional(),
    size: z.number().int().nonnegative().optional(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    originalPath: absolutePathSchema.nullable().optional(),
  })
  .strict();
export const attachmentReadSchema = z.object({ path: absolutePathSchema }).strict();

const jsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([jsonPrimitiveSchema, z.array(jsonValueSchema), z.record(jsonValueSchema)]),
);

export const threadStartSchema = z
  .object({
    cwd: absolutePathSchema,
    model: z.string().min(1).max(256).optional(),
    approvalPolicy: policySchema.optional(),
    sandboxMode: sandboxModeSchema.optional(),
  })
  .strict();

export const threadIdSchema = z.object({ threadId: idSchema }).strict();
export const threadRenameSchema = z
  .object({ threadId: idSchema, name: z.string().trim().min(1).max(160) })
  .strict();
export const historySchema = z
  .object({
    threadId: idSchema,
    turnsCursor: z.string().nullable().optional(),
    itemsCursor: z.string().nullable().optional(),
    turnsLimit: z.number().int().min(1).max(100),
    itemsLimit: z.number().int().min(1).max(250),
    sortDirection: z.enum(['asc', 'desc']),
  })
  .strict();

export const startTurnSchema = z
  .object({
    threadId: idSchema,
    text: z.string().max(1_000_000),
    attachments: z.array(attachmentSchema).max(20).optional(),
    mentions: z
      .array(z.object({ name: z.string().min(1).max(512), path: absolutePathSchema }).strict())
      .max(100)
      .optional(),
    explicitSkills: z
      .array(z.object({ name: z.string().min(1).max(512), path: absolutePathSchema }).strict())
      .max(20)
      .optional(),
    explicitTools: z
      .array(z.object({
        server: z.string().trim().min(1).max(512),
        name: z.string().trim().min(1).max(512),
      }).strict())
      .max(20)
      .optional(),
    explicitDynamicTools: z
      .array(z.object({
        pluginId: idSchema,
        name: z.string().trim().min(1).max(128),
      }).strict())
      .max(20)
      .optional(),
    pluginContexts: z
      .array(z.object({
        pluginId: idSchema,
        contributionId: idSchema,
        label: z.string().trim().min(1).max(512),
        value: jsonValueSchema,
        toolHints: z
          .array(z.object({
            server: z.string().trim().min(1).max(512),
            name: z.string().trim().min(1).max(512),
          }).strict())
          .max(20)
          .optional(),
      }).strict())
      .max(20)
      .optional(),
    model: z.string().min(1).max(256).optional(),
    effort: z.string().min(1).max(64).optional(),
    cwd: absolutePathSchema.optional(),
    approvalPolicy: policySchema.optional(),
    sandboxMode: sandboxModeSchema.optional(),
    resumeOperationId: idSchema.optional(),
  })
  .strict()
  .refine(
    (value) => value.text.trim().length > 0 || (value.attachments?.length ?? 0) > 0,
    '消息或文件附件至少需要一项',
  );

export const steerTurnSchema = startTurnSchema.and(
  z.object({ turnId: idSchema }).strict(),
);

export const interruptSchema = z.object({ threadId: idSchema, turnId: idSchema }).strict();

export const approvalResponseSchema = z
  .object({
    requestId: requestIdSchema,
    method: z.string().min(1).max(512),
    response: jsonValueSchema,
  })
  .strict();

export const configReadSchema = z.object({ cwd: absolutePathSchema.optional() }).strict();
export const configWriteSchema = z
  .object({
    keyPath: z.enum(['model', 'model_reasoning_effort', 'approval_policy', 'sandbox_mode']),
    value: jsonValueSchema,
    expectedVersion: z.string().optional(),
  })
  .strict();

const catalogNameSchema = z.string().trim().min(1).max(512);

export const pluginListSchema = z
  .object({
    cwd: absolutePathSchema.optional(),
    forceRefetch: z.boolean().optional(),
  })
  .strict();

export const pluginLocationSchema = z
  .object({
    pluginId: idSchema,
    marketplaceName: catalogNameSchema,
    marketplacePath: absolutePathSchema.nullable(),
    pluginName: catalogNameSchema,
  })
  .strict();

export const pluginUninstallSchema = z.object({ pluginId: idSchema }).strict();
export const pluginCredentialConfigureSchema = pluginLocationSchema.extend({
  credentialId: idSchema,
  value: z.string().max(16_384).nullable(),
}).strict();
export const pluginSetEnabledSchema = z
  .object({
    pluginId: idSchema,
    marketplaceName: catalogNameSchema,
    marketplacePath: absolutePathSchema.nullable(),
    pluginName: catalogNameSchema,
    enabled: z.boolean(),
  })
  .strict();

export const pluginMcpCallSchema = z
  .object({
    pluginId: idSchema,
    principal: z.string().trim().min(3).max(256),
    threadId: idSchema.nullable(),
    server: catalogNameSchema,
    tool: catalogNameSchema,
    arguments: jsonValueSchema.optional(),
  })
  .strict();

export const marketplaceAddSchema = z
  .object({
    source: z.string().trim().min(1).max(4_096),
    refName: z.string().trim().min(1).max(512).optional(),
  })
  .strict();

export const marketplaceNameSchema = z.object({ marketplaceName: catalogNameSchema }).strict();
export const marketplaceUpgradeSchema = z
  .object({ marketplaceName: catalogNameSchema.optional() })
  .strict();
export const marketplaceSourceEnabledSchema = z
  .object({ marketplaceName: catalogNameSchema, enabled: z.boolean() })
  .strict();

export const skillsListSchema = z
  .object({
    cwd: absolutePathSchema.optional(),
    forceReload: z.boolean().optional(),
  })
  .strict();

export const skillSetEnabledSchema = z
  .object({
    path: absolutePathSchema,
    scope: z.enum(['user', 'repo', 'system', 'admin']),
    pluginId: idSchema.nullable(),
    enabled: z.boolean(),
  })
  .strict();

export const mcpListSchema = z.object({ threadId: idSchema.optional() }).strict();
export const mcpLoginSchema = z
  .object({ name: catalogNameSchema, threadId: idSchema.optional() })
  .strict();
export const mcpSetEnabledSchema = z
  .object({ name: catalogNameSchema, pluginId: idSchema, enabled: z.boolean() })
  .strict();

export const clipboardAttachmentSchema = z
  .object({
    name: z.string().trim().min(1).max(512),
    dataUrl: z
      .string()
      .max(70_000_000)
      .regex(/^data:[^,;]{0,256};base64,[A-Za-z0-9+/=]+$/),
  })
  .strict();

export const fileSearchSchema = z
  .object({
    projectPath: absolutePathSchema,
    query: z.string().max(512),
  })
  .strict();

const timezoneSchema = z.string().trim().min(1).max(128).refine((value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}, '无效的 IANA 时区');

const scheduledPluginContextSchema = z.object({
  pluginId: idSchema,
  contributionId: idSchema,
  label: z.string().trim().min(1).max(512),
  value: jsonValueSchema,
  toolHints: z.array(z.object({
    server: z.string().trim().min(1).max(512),
    name: z.string().trim().min(1).max(512),
  }).strict()).max(20).optional(),
}).strict();

const scheduledTaskFields = {
  id: idSchema,
  name: z.string().trim().min(1).max(160),
  projectId: idSchema,
  cwd: absolutePathSchema,
  prompt: z.string().trim().min(1).max(1_000_000),
  enabled: z.boolean(),
  preset: z.enum(['hourly', 'daily', 'weekdays', 'weekly', 'custom']),
  cron: z.string().trim().max(256).refine(
    (value) => value.split(/\s+/).length === 5,
    'Cron 必须是 5 段表达式',
  ),
  timezone: timezoneSchema,
  model: z.string().min(1).max(256).optional(),
  effort: z.string().min(1).max(64),
  approvalPolicy: policySchema,
  sandboxMode: sandboxModeSchema,
  pluginContexts: z.array(scheduledPluginContextSchema).max(20).optional(),
};

export const scheduledTaskCreateSchema = z.object(scheduledTaskFields).strict();
export const scheduledTaskUpdateSchema = z.object(scheduledTaskFields).strict();
export const scheduledTaskIdSchema = z.object({ taskId: idSchema }).strict();

const proxyUrlSchema = z
  .string()
  .trim()
  .max(4_096)
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return (
        ['http:', 'https:', 'socks5:', 'socks5h:'].includes(url.protocol) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, '代理地址必须使用 http、https、socks5 或 socks5h，且不能包含用户名或密码');

const responsesBaseUrlSchema = z
  .string()
  .trim()
  .max(4_096)
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
    } catch {
      return false;
    }
  }, 'Provider 地址必须是无内嵌凭据的 HTTP/HTTPS URL');

const runtimeReasoningEffortSchema = z.enum([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
]);

const runtimeModelCapabilitiesSchema = z
  .object({
    contextWindow: z.number().int().min(1_024).max(10_000_000),
    imageInput: z.boolean(),
    supportsReasoning: z.boolean(),
    reasoningEfforts: z.array(runtimeReasoningEffortSchema).min(1).max(8),
    defaultReasoningEffort: runtimeReasoningEffortSchema,
    supportsReasoningSummaries: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.reasoningEfforts.includes(value.defaultReasoningEffort)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['defaultReasoningEffort'],
        message: '默认推理档位必须包含在支持档位中',
      });
    }
  });

export const runtimeConnectionInputSchema = z
  .object({
    proxy: z
      .object({
        mode: z.enum(['inherit', 'off', 'custom']),
        url: proxyUrlSchema,
        noProxy: z.string().trim().max(8_192),
      })
      .strict(),
    provider: z
      .object({
        mode: z.literal('custom'),
        id: z.string().trim().max(64).regex(/^[a-z][a-z0-9_-]*$/, 'Provider ID 只能包含小写字母、数字、_ 和 -'),
        name: z.string().trim().max(160),
        baseUrl: responsesBaseUrlSchema,
        model: z.string().trim().max(256),
        capabilities: runtimeModelCapabilitiesSchema,
        apiKey: z.string().max(16_384).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.proxy.mode === 'custom' && !value.proxy.url) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['proxy', 'url'],
        message: '自定义代理需要填写代理地址',
      });
    }
    if (value.provider.mode === 'custom') {
      for (const [key, label] of [
        ['name', 'Provider 名称'],
        ['baseUrl', 'Responses Base URL'],
        ['model', '模型名称'],
      ] as const) {
        if (!value.provider[key]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['provider', key],
            message: `${label}不能为空`,
          });
        }
      }
    }
  });

const runtimeStatusSchema = z.object({
  phase: z.enum(['stopped', 'starting', 'ready', 'reconnecting', 'faulted', 'unavailable']),
  generation: z.number().int().nonnegative(),
  pid: z.number().int().nullable(),
  codexVersion: z.string().nullable(),
  protocolVersion: z.string().nullable(),
  sidecarHome: z.string(),
  codexHome: z.string(),
  diagnosticLog: z.string(),
  restartAttempt: z.number().int().nonnegative(),
  message: z.string().nullable(),
});

export const whaleEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('notification'),
    generation: z.number().int().nonnegative(),
    sequence: z.number().int().nonnegative(),
    message: z.object({ method: z.string(), params: z.unknown().optional() }).passthrough(),
  }),
  z.object({
    kind: z.literal('serverRequest'),
    generation: z.number().int().nonnegative(),
    sequence: z.number().int().nonnegative(),
    message: z
      .object({
        id: requestIdSchema,
        method: z.string(),
        params: z.unknown().optional(),
      })
      .passthrough(),
  }),
  z.object({
    kind: z.literal('runtime'),
    generation: z.number().int().nonnegative(),
    sequence: z.number().int().nonnegative(),
    event: z.discriminatedUnion('type', [
      z.object({ type: z.literal('status'), status: runtimeStatusSchema }),
      z.object({
        type: z.literal('diagnostic'),
        level: z.enum(['info', 'warning', 'error']),
        message: z.string(),
      }),
      z.object({
        type: z.literal('menu'),
        command: z.enum(['open-project', 'new-thread', 'command-palette', 'toggle-diff']),
      }),
      z.object({
        type: z.literal('turnChanges'),
        threadId: idSchema,
        snapshot: z.object({
          turnId: idSchema,
          cwd: absolutePathSchema,
          files: z.array(z.object({
            path: z.string(),
            kind: z.enum(['created', 'modified', 'deleted']),
            size: z.number().nullable(),
            binary: z.boolean(),
            createdAt: z.number().nullable(),
            modifiedAt: z.number().nullable(),
          })),
          diff: z.string(),
          updatedAt: z.number(),
        }),
      }),
      z.object({
        type: z.literal('scheduledTasksChanged'),
        tasks: z.array(z.object(scheduledTaskFields).passthrough()),
      }),
      z.object({
        type: z.literal('scheduledRunUpdated'),
        run: z.object({
          id: idSchema,
          taskId: idSchema,
          trigger: z.enum(['schedule', 'manual']),
          scheduledAt: z.number(),
          startedAt: z.number().nullable(),
          completedAt: z.number().nullable(),
          status: z.enum(['running', 'waitingApproval', 'completed', 'failed', 'skipped']),
          threadId: idSchema.nullable(),
          turnId: idSchema.nullable(),
          error: z.string().nullable(),
          skippedReason: z.enum(['missed', 'conflict', 'runtimeUnavailable']).nullable(),
        }),
      }),
      z.object({
        type: z.literal('authChanged'),
        state: z.discriminatedUnion('status', [
          z.object({ status: z.literal('logged-out'), user: z.null(), message: z.null() }),
          z.object({ status: z.literal('waiting'), user: z.null(), message: z.null() }),
          z.object({
            status: z.literal('logged-in'),
            user: z.object({
              id: z.string().min(1),
              username: z.string().min(1),
              displayName: z.string().min(1),
              email: z.string().nullable(),
              avatar: z.string().nullable(),
              departments: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
              primaryDepartmentId: z.string().nullable().optional(),
            }),
            message: z.null(),
          }),
          z.object({ status: z.literal('error'), user: z.null(), message: z.string().min(1) }),
        ]),
      }),
    ]),
  }),
]);
