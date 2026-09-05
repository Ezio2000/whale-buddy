import { confirmAction } from '../state/confirmation';
import { SettingsSurface } from './SettingsSurface';
import * as Dialog from '@radix-ui/react-dialog';
import {
  AlertCircle,
  BookOpen,
  Boxes,
  Check,
  ChevronRight,
  CircleOff,
  Cloud,
  Download,
  FileCode2,
  FileText,
  KeyRound,
  LoaderCircle,
  PanelsTopLeft,
  PackageOpen,
  PlugZap,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { McpServerStatus } from '../../generated/protocol/typescript/v2/McpServerStatus';
import type { PluginDetail } from '../../generated/protocol/typescript/v2/PluginDetail';
import type { PluginMarketplaceEntry } from '../../generated/protocol/typescript/v2/PluginMarketplaceEntry';
import type { PluginSummary } from '../../generated/protocol/typescript/v2/PluginSummary';
import type { SkillMetadata } from '../../generated/protocol/typescript/v2/SkillMetadata';
import type { ListMcpServerStatusResponse } from '../../generated/protocol/typescript/v2/ListMcpServerStatusResponse';
import type { PluginListResponse } from '../../generated/protocol/typescript/v2/PluginListResponse';
import type { SkillsListResponse } from '../../generated/protocol/typescript/v2/SkillsListResponse';
import type {
  ExtensionPluginPolicy,
  ExtensionPolicySnapshot,
  ExtensionSource,
} from '../../shared/extension-policy';
import type { PluginUiContribution, PluginWebMcpTool } from '../../shared/plugin';
import type { PluginCredentialValue } from '../../shared/plugin-credentials';
import type { PluginLocationInput } from '../../shared/types';
import type {
  PluginHookMetadata,
  PluginHookPreview,
  PluginHookPreviewItem,
} from '../../shared/plugin-hooks';
import { useAppStore } from '../state/store';

type MarketplaceTab = 'plugins' | 'skills' | 'mcp' | 'sources';

interface LocatedPlugin {
  marketplace: PluginMarketplaceEntry;
  plugin: PluginSummary;
  location: PluginLocationInput;
}

type McpDisplayServer = McpServerStatus & {
  declaredOnly: boolean;
  pluginEnabled: boolean;
  enabled: boolean;
};

type ContributionDialogState =
  | {
      kind: 'skill';
      name: string;
      description: string;
      enabled: boolean | null;
      path: string;
      contents: string;
    }
  | {
      kind: 'mcp';
      pluginId: string | null;
      name: string;
      enabled: boolean;
      path: string;
      configuration: string;
      tools: Array<{ name: string; description: string }>;
    };

const emptyPluginResponse: PluginListResponse = {
  marketplaces: [],
  marketplaceLoadErrors: [],
  featuredPluginIds: [],
};

const emptySkillResponse: SkillsListResponse = { data: [] };
const emptyMcpResponse: ListMcpServerStatusResponse = { data: [], nextCursor: null };
const emptyExtensionPolicy: ExtensionPolicySnapshot = {
  sources: [],
  plugins: [],
  enabledSkillPaths: [],
};
const emptyHookPreview: PluginHookPreview = {
  pluginId: '', sourcePath: null, digest: null, hooks: [], errors: [], supported: true,
};

type HookTrustRequest =
  | { kind: 'plugin'; located: LocatedPlugin; hooks: PluginHookPreviewItem[]; digest: string }
  | { kind: 'hook'; hook: PluginHookMetadata; preview: PluginHookPreviewItem | null };

export function PluginMarketplaceDialog({ embedded = false }: { embedded?: boolean }) {
  const Title = embedded ? 'h1' : Dialog.Title;
  const Description = embedded ? 'p' : Dialog.Description;
  const open = useAppStore((state) => state.pluginMarketplaceOpen);
  const setOpen = useAppStore((state) => state.setPluginMarketplaceOpen);
  const brandName = useAppStore((state) => state.branding.name);
  const selectedProject = useAppStore((state) =>
    state.projects.find((project) => project.id === state.selectedProjectId),
  );
  const [tab, setTab] = useState<MarketplaceTab>('plugins');
  const [query, setQuery] = useState('');
  const [plugins, setPlugins] = useState<PluginListResponse>(emptyPluginResponse);
  const [skills, setSkills] = useState<SkillsListResponse>(emptySkillResponse);
  const [mcp, setMcp] = useState<ListMcpServerStatusResponse>(emptyMcpResponse);
  const [uiContributions, setUiContributions] = useState<PluginUiContribution[]>([]);
  const [webMcpTools, setWebMcpTools] = useState<PluginWebMcpTool[]>([]);
  const [extensionPolicy, setExtensionPolicy] =
    useState<ExtensionPolicySnapshot>(emptyExtensionPolicy);
  const [selectedLocation, setSelectedLocation] = useState<PluginLocationInput | null>(null);
  const [detail, setDetail] = useState<PluginDetail | null>(null);
  const [credentials, setCredentials] = useState<PluginCredentialValue[]>([]);
  const [hookPreview, setHookPreview] = useState<PluginHookPreview>(emptyHookPreview);
  const [liveHooks, setLiveHooks] = useState<PluginHookMetadata[]>([]);
  const [hookTrust, setHookTrust] = useState<HookTrustRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [capabilityDetail, setCapabilityDetail] =
    useState<ContributionDialogState | null>(null);
  const [mutationKey, setMutationKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState('');
  const [refName, setRefName] = useState('');

  const loadAll = useCallback(
    async (force = false): Promise<string[]> => {
      setLoading(true);
      setError(null);
      const context = selectedProject?.path ? { cwd: selectedProject.path } : {};
      const [pluginResult, skillResult, mcpResult, policyResult] = await Promise.allSettled([
        window.whale.plugins.list({ ...context, forceRefetch: force }),
        window.whale.skills.list({ ...context, forceReload: force }),
        window.whale.mcp.list({}),
        window.whale.marketplaces.sources(),
      ]);
      const failures: string[] = [];
      const resolvedPolicy = policyResult.status === 'fulfilled'
        ? policyResult.value
        : emptyExtensionPolicy;
      setExtensionPolicy(resolvedPolicy);
      if (pluginResult.status === 'fulfilled') {
        setPlugins(pluginResult.value);
        if (pluginResult.value.marketplaceLoadErrors.length) {
          failures.push(`${pluginResult.value.marketplaceLoadErrors.length} 个插件目录加载失败`);
        }
        const first = firstLocatedPlugin(pluginResult.value);
        setSelectedLocation((current) =>
          current && resolvedPolicy.sources.some(
            (source) => source.name === current.marketplaceName && source.enabled,
          )
            ? current
            : first?.location ?? null,
        );
      } else {
        failures.push(`插件目录：${errorMessage(pluginResult.reason)}`);
      }
      if (skillResult.status === 'fulfilled') setSkills(skillResult.value);
      else failures.push(`Skills：${errorMessage(skillResult.reason)}`);
      if (mcpResult.status === 'fulfilled') setMcp(mcpResult.value);
      else failures.push(`MCP：${errorMessage(mcpResult.reason)}`);
      if (policyResult.status === 'rejected') {
        failures.push(`扩展策略：${errorMessage(policyResult.reason)}`);
      }
      setError(failures.length ? failures.join('；') : null);
      setLoading(false);
      return failures;
    },
    [selectedProject?.path],
  );

  // Keep an open preview tied to the latest runtime catalog, not its click-time snapshot.
  useEffect(() => {
    setCapabilityDetail((current) => {
      if (current?.kind !== 'mcp') return current;
      const server = mcp.data.find((entry) => entry.name === current.name && entry.pluginId === current.pluginId);
      return { ...current, tools: Object.entries(server?.tools ?? {}).flatMap(([key, tool]) => tool ? [{
        name: tool.name || key, description: tool.description || tool.title || '此工具没有提供说明。',
      }] : []) };
    });
  }, [mcp]);

  const loadMcp = useCallback(async () => {
    const response = await window.whale.mcp.list({});
    setMcp(response);
  }, []);

  useEffect(() => {
    if (!open) return;
    setMessage(null);
    void loadAll(false);
  }, [loadAll, open]);

  useEffect(() => {
    if (!message && !error) return;
    const timer = window.setTimeout(() => {
      setMessage(null);
      setError(null);
    }, 3_000);
    return () => window.clearTimeout(timer);
  }, [error, message]);

  useEffect(() => {
    if (!open) return;
    return window.whale.events.subscribe((event) => {
      if (
        event.kind === 'notification' &&
        (event.message.method === 'mcpServer/oauthLogin/completed' ||
          event.message.method === 'mcpServer/startupStatus/updated')
      ) {
        void loadMcp().catch((reason) => setError(errorMessage(reason)));
      }
    });
  }, [loadMcp, open]);

  useEffect(() => {
    if (!open || !selectedLocation) {
      setDetail(null);
      setCredentials([]);
      setUiContributions([]);
      setWebMcpTools([]);
      setHookPreview(emptyHookPreview);
      setLiveHooks([]);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetail(null);
    setCredentials([]);
    setUiContributions([]);
    setWebMcpTools([]);
    setHookPreview(emptyHookPreview);
    setLiveHooks([]);
    const selectedPolicy = extensionPolicy.plugins.find(
      (entry) => entry.pluginId === selectedLocation.pluginId,
    );
    void Promise.allSettled([
      window.whale.plugins.read(selectedLocation),
      window.whale.plugins.credentials(selectedLocation),
      window.whale.plugins.contributions(selectedLocation),
      window.whale.hooks.previewPlugin(selectedLocation),
      selectedPolicy?.enabled
        ? window.whale.hooks.list(selectedProject?.path ? { cwd: selectedProject.path } : {})
        : Promise.resolve(null),
    ])
      .then(([detailResult, credentialResult, contributionResult, previewResult, hookListResult]) => {
        if (cancelled) return;
        if (detailResult.status === 'fulfilled') setDetail(detailResult.value.plugin);
        else setError(`读取插件详情失败：${errorMessage(detailResult.reason)}`);
        if (credentialResult.status === 'fulfilled') {
          setCredentials(credentialResult.value.credentials);
        } else {
          setError(`读取插件凭据失败：${errorMessage(credentialResult.reason)}`);
        }
        if (contributionResult.status === 'fulfilled') {
          setUiContributions(contributionResult.value.uiContributions ?? []);
          setWebMcpTools(contributionResult.value.webMcp?.tools ?? []);
        } else {
          setError(`读取插件贡献失败：${errorMessage(contributionResult.reason)}`);
        }
        if (previewResult.status === 'fulfilled') setHookPreview(previewResult.value);
        else setError(`读取 Hook 配置失败：${errorMessage(previewResult.reason)}`);
        if (hookListResult.status === 'fulfilled' && hookListResult.value) {
          setLiveHooks(hookListResult.value.data.flatMap((entry) => entry.hooks).filter(
            (hook) => hook.pluginId === selectedLocation.pluginId,
          ));
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [extensionPolicy.plugins, open, selectedLocation, selectedProject?.path]);

  const visiblePluginCatalog = plugins;
  const locatedPlugins = useMemo(() => flattenPlugins(visiblePluginCatalog), [visiblePluginCatalog]);
  const visiblePlugins = useMemo(() => {
    const needle = normalizeSearch(query);
    const featured = new Set(visiblePluginCatalog.featuredPluginIds);
    return locatedPlugins
      .filter(({ plugin, marketplace }) => {
        if (!needle) return true;
        return normalizeSearch([
          plugin.name,
          plugin.interface?.displayName,
          plugin.interface?.shortDescription,
          plugin.interface?.longDescription,
          plugin.interface?.developerName,
          marketplace.name,
          ...plugin.keywords,
        ].filter(Boolean).join(' ')).includes(needle);
      })
      .sort((left, right) => compareLocatedPlugins(left, right, featured));
  }, [locatedPlugins, query, visiblePluginCatalog.featuredPluginIds]);
  const visibleSkills = useMemo(
    () => filterSkills(skills, query),
    [query, skills],
  );
  const effectiveSkills = useMemo(
    () => filterSkills(skills, ''),
    [skills],
  );
  const effectiveMcp = useMemo(
    () => mergeDeclaredMcpServers(mcp.data, extensionPolicy.plugins, locatedPlugins),
    [extensionPolicy.plugins, locatedPlugins, mcp.data],
  );
  const visibleMcp = useMemo(
    () => filterMcp(effectiveMcp, query),
    [effectiveMcp, query],
  );
  const visibleSkillErrors = useMemo(
    () => skills.data.flatMap((entry) => entry.errors),
    [skills.data],
  );
  const pluginLocationFor = (pluginId: string): PluginLocationInput | null => {
    const policy = extensionPolicy.plugins.find((entry) => entry.pluginId === pluginId);
    const located = locatedPlugins.find((entry) =>
      entry.plugin.id === pluginId
      && (!policy || entry.marketplace.name === policy.marketplaceName)
    );
    return located?.location ?? null;
  };

  const previewSkill = async (skill: SkillMetadata) => {
    const initial: ContributionDialogState = {
      kind: 'skill',
      name: skillDisplayName(skill),
      description: skill.interface?.shortDescription ?? skill.shortDescription ?? skill.description,
      enabled: skill.enabled,
      path: skill.path,
      contents: skill.pluginId ? '正在读取 Skill 内容…' : '内容不可用',
    };
    setCapabilityDetail(initial);
    if (!skill.pluginId) return;
    const location = pluginLocationFor(skill.pluginId);
    if (!location) return;
    try {
      const contributions = await window.whale.plugins.contributions(location);
      const file = contributions.skills.find((entry) =>
        entry.path === skill.path
        || entry.name === skill.name
        || skill.name.endsWith(`:${entry.name}`)
      );
      setCapabilityDetail((current) => current?.kind === 'skill' && current.path === skill.path
        ? { ...current, path: file?.path ?? current.path, contents: file?.contents ?? '内容不可用' }
        : current);
    } catch (reason) {
      setCapabilityDetail((current) => current?.kind === 'skill' && current.path === skill.path
        ? { ...current, contents: `读取失败：${errorMessage(reason)}` }
        : current);
    }
  };

  const previewMcp = async (server: McpServerStatus, enabled: boolean) => {
    const tools = Object.entries(server.tools).flatMap(([key, tool]) => tool ? [{
      name: tool.name || key,
      description: tool.description || tool.title || '此工具没有提供说明。',
    }] : []);
    const initial: ContributionDialogState = {
      kind: 'mcp',
      pluginId: server.pluginId,
      name: server.name,
      enabled,
      path: '正在读取 MCP 配置…',
      configuration: '正在读取 MCP 配置…',
      tools,
    };
    setCapabilityDetail(initial);
    if (!server.pluginId) return;
    const location = pluginLocationFor(server.pluginId);
    if (!location) return;
    try {
      const contributions = await window.whale.plugins.contributions(location);
      const declared = contributions.mcp?.servers.find((entry) => entry.name === server.name);
      setCapabilityDetail((current) => current?.kind === 'mcp' && current.name === server.name && current.pluginId === server.pluginId
        ? {
            ...current,
            path: contributions.mcp?.path ?? '路径不可用',
            configuration: declared
              ? JSON.stringify(declared.config, null, 2)
              : contributions.mcp?.contents ?? '配置不可用',
          }
        : current);
    } catch (reason) {
      setCapabilityDetail((current) => current?.kind === 'mcp' && current.name === server.name
        ? {
            ...current,
            path: '路径不可用',
            configuration: `读取失败：${errorMessage(reason)}`,
          }
        : current);
    }
  };
  const refreshAfterMutation = async (notice: string) => {
    await loadAll(false);
    setMessage(notice);
  };

  const setPluginEnabled = async (located: LocatedPlugin, approvedHookDigest?: string) => {
    const enabled = pluginPolicyEnabled(located.plugin.id, extensionPolicy.plugins);
    const policy = await window.whale.plugins.setEnabled({
      ...located.location,
      enabled: !enabled,
      ...(selectedProject?.path ? { cwd: selectedProject.path } : {}),
      ...(approvedHookDigest ? { approvedHookDigest } : {}),
    });
    setExtensionPolicy(policy);
    await refreshAfterMutation(
      enabled
        ? `插件“${pluginDisplayName(located.plugin)}”已停用；运行时已重启。`
        : `插件“${pluginDisplayName(located.plugin)}”已启用；贡献能力与已确认 Hook 已生效。`,
    );
  };

  const mutatePlugin = async (located: LocatedPlugin) => {
    const { plugin, location } = located;
    const enabled = pluginPolicyEnabled(plugin.id, extensionPolicy.plugins);
    if (!plugin.installed &&
      !await confirmAction(
        `下载“${pluginDisplayName(plugin)}”？下载后仍保持停用，需要你再次明确启用。`,
      )
    ) {
      return;
    }
    if (plugin.installed && !enabled) {
      const preview = await window.whale.hooks.previewPlugin(location).catch((reason) => {
        setError(`读取 Hook 配置失败：${errorMessage(reason)}`);
        return null;
      });
      if (!preview) return;
      setHookPreview(preview);
      if (!preview.supported) {
        setError(`插件 Hook 不兼容：${preview.errors.join('；')}`);
        return;
      }
      if (preview.hooks.length > 0 && preview.digest) {
        setHookTrust({ kind: 'plugin', located, hooks: preview.hooks, digest: preview.digest });
        return;
      }
      if (!await confirmAction(`启用“${pluginDisplayName(plugin)}”？它包含的全部 Skills 与 MCP 将恢复为默认开启。`, { confirmLabel: '启用插件' })) return;
    }

    setMutationKey(plugin.id);
    setError(null);
    setMessage(null);
    try {
      if (plugin.installed) {
        await setPluginEnabled(located);
      } else {
        const response = await window.whale.plugins.install(location);
        const authHint = response.appsNeedingAuth.length
          ? `，另有 ${response.appsNeedingAuth.length} 个连接需要认证`
          : '';
        await refreshAfterMutation(`插件已下载并保持停用${authHint}；确认后再启用。`);
      }
    } catch (reason) {
      setError(`${plugin.installed ? (enabled ? '停用' : '启用') : '下载'}失败：${errorMessage(reason)}`);
    } finally {
      setMutationKey(null);
    }
  };

  const uninstallPlugin = async (located: LocatedPlugin) => {
    if (!await confirmAction(`彻底卸载“${pluginDisplayName(located.plugin)}”？`, { confirmLabel: '卸载插件', danger: true })) return;
    setMutationKey(`uninstall:${located.plugin.id}`);
    setError(null);
    try {
      await window.whale.plugins.uninstall(located.location);
      await refreshAfterMutation('插件已卸载，缓存贡献不会再参与运行。');
    } catch (reason) {
      setError(`卸载失败：${errorMessage(reason)}`);
    } finally {
      setMutationKey(null);
    }
  };

  const toggleHook = async (hook: PluginHookMetadata, enabled: boolean) => {
    if (enabled && hook.trustStatus !== 'trusted') {
      setHookTrust({
        kind: 'hook',
        hook,
        preview: hookPreview.hooks.find((entry) => entry.key === hook.key) ?? null,
      });
      return;
    }
    setMutationKey(`hook:${hook.key}`);
    setError(null);
    try {
      const response = await window.whale.hooks.setEnabled({
        key: hook.key,
        enabled,
        ...(selectedProject?.path ? { cwd: selectedProject.path } : {}),
      });
      setLiveHooks(response.data.flatMap((entry) => entry.hooks).filter(
        (entry) => entry.pluginId === hook.pluginId,
      ));
      setMessage(`Hook 已${enabled ? '启用' : '停用'}。`);
    } catch (reason) {
      setError(`更新 Hook 失败：${errorMessage(reason)}`);
    } finally {
      setMutationKey(null);
    }
  };

  const approveHookTrust = async () => {
    const request = hookTrust;
    if (!request) return;
    setHookTrust(null);
    if (request.kind === 'plugin') {
      setMutationKey(request.located.plugin.id);
      try {
        await setPluginEnabled(request.located, request.digest);
      } catch (reason) {
        setError(`启用失败：${errorMessage(reason)}`);
      } finally {
        setMutationKey(null);
      }
      return;
    }
    setMutationKey(`hook:${request.hook.key}`);
    try {
      const response = await window.whale.hooks.setEnabled({
        key: request.hook.key,
        enabled: true,
        expectedCurrentHash: request.hook.currentHash,
        trustCurrentDefinition: true,
        ...(selectedProject?.path ? { cwd: selectedProject.path } : {}),
      });
      setLiveHooks(response.data.flatMap((entry) => entry.hooks).filter(
        (entry) => entry.pluginId === request.hook.pluginId,
      ));
      setMessage('Hook 已信任并启用。');
    } catch (reason) {
      setError(`信任 Hook 失败：${errorMessage(reason)}`);
    } finally {
      setMutationKey(null);
    }
  };

  const configureCredential = async (
    credentialId: string,
    value: string | null,
  ): Promise<void> => {
    if (!selectedLocation) throw new Error('尚未选择插件');
    setMutationKey(`credential:${credentialId}`);
    setError(null);
    setMessage(null);
    try {
      const snapshot = await window.whale.plugins.configureCredential({
        ...selectedLocation,
        credentialId,
        value,
      });
      setCredentials(snapshot.credentials);
      setMessage(value === null ? '插件凭据已清除。' : '插件凭据已安全保存并生效。');
    } catch (reason) {
      setError(`更新插件凭据失败：${errorMessage(reason)}`);
      throw reason;
    } finally {
      setMutationKey(null);
    }
  };

  const toggleSkill = async (skill: SkillMetadata) => {
    setMutationKey(`skill:${skill.path}`);
    setError(null);
    try {
      const response = await window.whale.skills.setEnabled({
        path: skill.path,
        scope: skill.scope,
        pluginId: skill.pluginId,
        enabled: !skill.enabled,
      });
      const refreshed = await window.whale.skills.list({
        ...(selectedProject?.path ? { cwd: selectedProject.path } : {}),
        forceReload: true,
      });
      setSkills(refreshed);
      setMessage(
        response.effectiveEnabled === !skill.enabled
          ? `Skill“${skillDisplayName(skill)}”已${response.effectiveEnabled ? '启用' : '停用'}；新线程中生效。`
          : `Skill“${skillDisplayName(skill)}”受更高优先级配置管理，状态未改变。`,
      );
    } catch (reason) {
      setError(`更新 Skill 失败：${errorMessage(reason)}`);
    } finally {
      setMutationKey(null);
    }
  };

  const loginMcp = async (server: McpServerStatus) => {
    setMutationKey(`mcp:${server.name}`);
    setError(null);
    try {
      await window.whale.mcp.login({
        name: server.name,
      });
      setMessage('已在系统浏览器打开 MCP 授权页；完成后状态会自动刷新。');
    } catch (reason) {
      setError(`启动 MCP 登录失败：${errorMessage(reason)}`);
    } finally {
      setMutationKey(null);
    }
  };

  const toggleMcp = async (server: McpServerStatus, enabled: boolean) => {
    if (!server.pluginId) return;
    await toggleDeclaredMcp(server.pluginId, server.name, enabled);
  };

  const toggleDeclaredMcp = async (pluginId: string, name: string, enabled: boolean) => {
    setMutationKey(`mcp-toggle:${name}`);
    setError(null);
    try {
      const policy = await window.whale.mcp.setEnabled({
        name,
        pluginId,
        enabled,
      });
      setExtensionPolicy(policy);
      await loadAll(false);
      setMessage(`MCP“${name}”已${enabled ? '启用' : '停用'}；运行时已重启。`);
    } catch (reason) {
      setError(`更新 MCP 失败：${errorMessage(reason)}`);
    } finally {
      setMutationKey(null);
    }
  };

  const addMarketplace = async (event: FormEvent) => {
    event.preventDefault();
    if (!source.trim()) return;
    setMutationKey('source:add');
    setError(null);
    try {
      const response = await window.whale.marketplaces.add({
        source: source.trim(),
        ...(refName.trim() ? { refName: refName.trim() } : {}),
      });
      setSource('');
      setRefName('');
      await refreshAfterMutation(
        response.alreadyAdded
          ? `商城源“${response.marketplaceName}”已存在。`
          : `商城源“${response.marketplaceName}”已添加。`,
      );
    } catch (reason) {
      setError(`添加商城源失败：${errorMessage(reason)}`);
    } finally {
      setMutationKey(null);
    }
  };

  const refreshEverything = async () => {
    setMutationKey('refresh:all');
    setError(null);
    setMessage(null);
    const failures: string[] = [];
    let selectedMarketplaceCount = 0;
    let upgradedMarketplaceCount = 0;
    try {
      try {
        const response = await window.whale.marketplaces.upgrade();
        selectedMarketplaceCount = response.selectedMarketplaces.length;
        upgradedMarketplaceCount = response.upgradedRoots.length;
        if (response.errors.length) {
          failures.push(`${response.errors.length} 个 Git 商城源拉取失败`);
        }
      } catch (reason) {
        failures.push(`Git 商城源：${errorMessage(reason)}`);
      }

      try {
        await window.whale.mcp.reload();
      } catch (reason) {
        failures.push(`MCP 配置：${errorMessage(reason)}`);
      }

      failures.push(...(await loadAll(true)));
      const marketplaceSummary = selectedMarketplaceCount
        ? `检查 ${selectedMarketplaceCount} 个 Git 商城源，拉取更新 ${upgradedMarketplaceCount} 个`
        : '没有已勾选的 Git 商城源需要拉取';
      if (failures.length) {
        setError(`部分刷新完成（${marketplaceSummary}）：${failures.join('；')}`);
      } else {
        setMessage(
          `全部刷新完成：${marketplaceSummary}；插件目录、Skills、MCP 配置与连接状态已更新。`,
        );
      }
    } finally {
      setMutationKey(null);
    }
  };

  const removeMarketplace = async (sourceEntry: ExtensionSource) => {
    if (!await confirmAction(`从 ${brandName} 移除商城源“${sourceEntry.title}”？`, { confirmLabel: '移除商城源', danger: true })) return;
    setMutationKey(`source:remove:${sourceEntry.name}`);
    setError(null);
    try {
      await window.whale.marketplaces.remove(sourceEntry.name);
      setSelectedLocation(null);
      await refreshAfterMutation(`商城源“${sourceEntry.title}”已移除。`);
    } catch (reason) {
      setError(`移除商城源失败：${errorMessage(reason)}`);
    } finally {
      setMutationKey(null);
    }
  };

  const toggleSource = async (
    sourceEntry: ExtensionSource,
    enabled: boolean,
  ) => {
    setMutationKey(`source:enable:${sourceEntry.name}`);
    setError(null);
    try {
      const updated = await window.whale.marketplaces.setEnabled(sourceEntry.name, enabled);
      setExtensionPolicy(updated);
      await loadAll(false);
      setMessage(`扩展源“${sourceEntry.title}”已${enabled ? '启用' : '停用'}；运行时已重启。`);
    } catch (reason) {
      setError(`更新扩展源失败：${errorMessage(reason)}`);
    } finally {
      setMutationKey(null);
    }
  };

  return (
    <SettingsSurface embedded={embedded} open={open} onOpenChange={setOpen} className="marketplace-dialog">
          <div className="marketplace-heading">
            <div className="marketplace-title">
              <span className="marketplace-title-icon"><PackageOpen size={19} /></span>
              <div>
                <Title>插件商城</Title>
                <Description>为你的工作添加工具与能力。选择插件查看用途，再下载和配置。</Description>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="icon-button dialog-close-target" aria-label="关闭插件商城">
              <X size={16} />
            </button>
          </div>

          <div className="marketplace-toolbar">
            <nav className="marketplace-tabs" aria-label="插件商城分类">
              <TabButton active={tab === 'plugins'} onClick={() => setTab('plugins')} icon={<Boxes size={14} />}>
                插件 <span>{locatedPlugins.length}</span>
              </TabButton>
              <TabButton active={tab === 'skills'} onClick={() => setTab('skills')} icon={<Sparkles size={14} />}>
                Skills <span>{visibleSkills.length}</span>
              </TabButton>
              <TabButton active={tab === 'mcp'} onClick={() => setTab('mcp')} icon={<PlugZap size={14} />}>
                MCP <span>{visibleMcp.length}</span>
              </TabButton>
              <TabButton active={tab === 'sources'} onClick={() => setTab('sources')} icon={<Cloud size={14} />}>
                商城源 <span>{extensionPolicy.sources.length}</span>
              </TabButton>
            </nav>
            {tab !== 'sources' && (
              <label className="marketplace-search">
                <Search size={14} />
                <span className="sr-only">搜索当前分类</span>
                <input
                  aria-label="搜索当前分类"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={tab === 'plugins'
                    ? '搜索插件'
                    : tab === 'skills'
                      ? '搜索 Skill'
                    : '搜索 MCP'}
                />
                {query && <button aria-label="清除搜索" onClick={() => setQuery('')}><X size={12} /></button>}
              </label>
            )}
            <button
              className="button secondary marketplace-refresh"
              aria-label="全部刷新"
              title="拉取已添加的 Git 商城源、重新获取插件目录、重新扫描 Skills、重新读取 MCP 配置并更新连接状态"
              disabled={loading || mutationKey !== null}
              onClick={() => void refreshEverything()}
            >
              <RefreshCw className={loading || mutationKey === 'refresh:all' ? 'spin' : ''} size={13} /> 全部刷新
            </button>
          </div>

          {(message || error) && (
            <div className={`marketplace-message ${error ? 'error' : ''}`} role="status">
              {error ? <AlertCircle size={14} /> : <Check size={14} />}
              <span>
                {error ?? message}
              </span>
              <button aria-label="关闭商城提示" onClick={() => { setMessage(null); setError(null); }}>
                <X size={12} />
              </button>
            </div>
          )}

          <div className="marketplace-body">
            {tab === 'plugins' && (
              <PluginBrowser
                plugins={visiblePlugins}
                featuredIds={visiblePluginCatalog.featuredPluginIds}
                selected={selectedLocation}
                detail={detail}
                detailLoading={detailLoading}
                mutationKey={mutationKey}
                pluginPolicies={extensionPolicy.plugins}
                effectiveSkills={effectiveSkills}
                uiContributions={uiContributions}
                webMcpTools={webMcpTools}
                credentials={credentials}
                hookPreview={hookPreview}
                liveHooks={liveHooks}
                onSelect={setSelectedLocation}
                onMutate={(located) => void mutatePlugin(located)}
                onUninstall={(located) => void uninstallPlugin(located)}
                onToggleSkill={(skill) => void toggleSkill(skill)}
                onToggleMcp={(pluginId, name, enabled) =>
                  void toggleDeclaredMcp(pluginId, name, enabled)
                }
                onConfigureCredential={configureCredential}
                onToggleHook={(hook, enabled) => void toggleHook(hook, enabled)}
              />
            )}
            {tab === 'skills' && (
              <SkillsManager
                skills={visibleSkills}
                errors={visibleSkillErrors}
                detail={capabilityDetail?.kind === 'skill' ? capabilityDetail : null}
                mutationKey={mutationKey}
                onToggle={(skill) => void toggleSkill(skill)}
                onPreview={(skill) => void previewSkill(skill)}
              />
            )}
            {tab === 'mcp' && (
              <McpManager
                brandName={brandName}
                servers={visibleMcp}
                detail={capabilityDetail?.kind === 'mcp' ? capabilityDetail : null}
                mutationKey={mutationKey}
                onLogin={(server) => void loginMcp(server)}
                onToggle={(server, enabled) => void toggleMcp(server, enabled)}
                onPreview={(server, enabled) => void previewMcp(server, enabled)}
              />
            )}
            {tab === 'sources' && (
              <MarketplaceSources
                brandName={brandName}
                sources={extensionPolicy.sources}
                source={source}
                refName={refName}
                mutationKey={mutationKey}
                onSourceChange={setSource}
                onRefChange={setRefName}
                onAdd={addMarketplace}
                onRemove={(sourceEntry) => void removeMarketplace(sourceEntry)}
                onEnabledChange={(sourceEntry, enabled) =>
                  void toggleSource(sourceEntry, enabled)
                }
              />
            )}
          </div>

          <footer className="marketplace-footer">
            <span>
              {selectedProject ? `项目：${selectedProject.name}` : `${brandName} 独立配置目录`}
            </span>
            <span>未启用的扩展不会加载、连接或注入线程</span>
          </footer>
          <HookTrustDialog
            request={hookTrust}
            onCancel={() => setHookTrust(null)}
            onApprove={() => void approveHookTrust()}
          />
    </SettingsSurface>
  );
}

function TabButton({
  active,
  icon,
  onClick,
  children,
}: {
  active: boolean;
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return <button className={active ? 'active' : ''} onClick={onClick}>{icon}{children}</button>;
}

function PluginBrowser({
  plugins,
  featuredIds,
  selected,
  detail,
  detailLoading,
  mutationKey,
  pluginPolicies,
  effectiveSkills,
  uiContributions,
  webMcpTools,
  credentials,
  hookPreview,
  liveHooks,
  onSelect,
  onMutate,
  onUninstall,
  onToggleSkill,
  onToggleMcp,
  onConfigureCredential,
  onToggleHook,
}: {
  plugins: LocatedPlugin[];
  featuredIds: string[];
  selected: PluginLocationInput | null;
  detail: PluginDetail | null;
  detailLoading: boolean;
  mutationKey: string | null;
  pluginPolicies: ExtensionPluginPolicy[];
  effectiveSkills: SkillMetadata[];
  uiContributions: PluginUiContribution[];
  webMcpTools: PluginWebMcpTool[];
  credentials: PluginCredentialValue[];
  hookPreview: PluginHookPreview;
  liveHooks: PluginHookMetadata[];
  onSelect: (location: PluginLocationInput) => void;
  onMutate: (plugin: LocatedPlugin) => void;
  onUninstall: (plugin: LocatedPlugin) => void;
  onToggleSkill: (skill: SkillMetadata) => void;
  onToggleMcp: (pluginId: string, name: string, enabled: boolean) => void;
  onConfigureCredential: (credentialId: string, value: string | null) => Promise<void>;
  onToggleHook: (hook: PluginHookMetadata, enabled: boolean) => void;
}) {
  if (!plugins.length) {
    return <EmptyState icon={<PackageOpen size={24} />} title="没有找到插件" description="可以刷新目录、清除搜索，或在“商城源”中添加一个插件目录。" />;
  }
  const featured = new Set(featuredIds);
  const selectedPlugin = selected
    ? plugins.find(({ location }) => sameLocation(location, selected)) ?? null
    : null;
  return (
    <div className="plugin-browser">
      <div className="plugin-card-list" aria-label="插件列表">
        {plugins.map((located) => {
          const displayName = pluginDisplayName(located.plugin);
          const active = selected ? sameLocation(located.location, selected) : false;
          const enabled = pluginPolicyEnabled(located.plugin.id, pluginPolicies);
          return (
            <article className={`plugin-card ${active ? 'selected' : ''}`} key={`${located.marketplace.name}:${located.plugin.id}`}>
              <button className="plugin-card-main" onClick={() => onSelect(located.location)}>
                <PluginGlyph plugin={located.plugin} />
                <span className="plugin-card-copy">
                  <span className="plugin-card-title">
                    <strong>{displayName}</strong>
                    {featured.has(located.plugin.id) && <small className="featured-pill">精选</small>}
                  </span>
                  <span>{pluginDescription(located.plugin)}</span>
                  <small>{marketplaceDisplayName(located.marketplace)} · {pluginCapabilitySummary(located.plugin)}</small>
                </span>
              </button>
              <button
                className="button secondary plugin-card-action"
                disabled={mutationKey !== null || located.plugin.availability !== 'AVAILABLE'}
                onClick={() => onMutate(located)}
              >
                {mutationKey === located.plugin.id ? <LoaderCircle className="spin" size={12} /> : located.plugin.installed ? enabled ? <CircleOff size={12} /> : <ShieldCheck size={12} /> : <Download size={12} />}
                {located.plugin.installed ? enabled ? '停用' : '启用' : '下载'}
              </button>
              <ChevronRight className="plugin-card-chevron" size={14} />
            </article>
          );
        })}
      </div>
      <aside className="plugin-detail-pane">
        <PluginDetailView
          located={selectedPlugin}
          detail={detail}
          loading={detailLoading}
          mutating={Boolean(selectedPlugin && mutationKey === selectedPlugin.plugin.id)}
          uninstalling={Boolean(selectedPlugin && mutationKey === `uninstall:${selectedPlugin.plugin.id}`)}
          pluginPolicy={selectedPlugin
            ? pluginPolicies.find((policy) => policy.pluginId === selectedPlugin.plugin.id) ?? null
            : null}
          effectiveSkills={effectiveSkills}
          uiContributions={selectedPlugin ? uiContributions : []}
          webMcpTools={selectedPlugin ? webMcpTools : []}
          credentials={credentials}
          hookPreview={hookPreview}
          liveHooks={liveHooks}
          mutationKey={mutationKey}
          onMutate={() => selectedPlugin && onMutate(selectedPlugin)}
          onUninstall={() => selectedPlugin && onUninstall(selectedPlugin)}
          onToggleSkill={onToggleSkill}
          onToggleMcp={(name, enabled) =>
            selectedPlugin && onToggleMcp(selectedPlugin.plugin.id, name, enabled)
          }
          onConfigureCredential={onConfigureCredential}
          onToggleHook={onToggleHook}
        />
      </aside>
    </div>
  );
}

function PluginDetailView({
  located,
  detail,
  loading,
  mutating,
  uninstalling,
  pluginPolicy,
  effectiveSkills,
  uiContributions,
  webMcpTools,
  credentials,
  hookPreview,
  liveHooks,
  mutationKey,
  onMutate,
  onUninstall,
  onToggleSkill,
  onToggleMcp,
  onConfigureCredential,
  onToggleHook,
}: {
  located: LocatedPlugin | null;
  detail: PluginDetail | null;
  loading: boolean;
  mutating: boolean;
  uninstalling: boolean;
  pluginPolicy: ExtensionPluginPolicy | null;
  effectiveSkills: SkillMetadata[];
  uiContributions: PluginUiContribution[];
  webMcpTools: PluginWebMcpTool[];
  credentials: PluginCredentialValue[];
  hookPreview: PluginHookPreview;
  liveHooks: PluginHookMetadata[];
  mutationKey: string | null;
  onMutate: () => void;
  onUninstall: () => void;
  onToggleSkill: (skill: SkillMetadata) => void;
  onToggleMcp: (name: string, enabled: boolean) => void;
  onConfigureCredential: (credentialId: string, value: string | null) => Promise<void>;
  onToggleHook: (hook: PluginHookMetadata, enabled: boolean) => void;
}) {
  if (!located) return <EmptyState icon={<Boxes size={22} />} title="选择一个插件" description="查看它包含的 Skills 与 MCP 服务。" />;
  const { plugin, marketplace } = located;
  const pluginEnabled = pluginPolicy?.enabled === true;
  const missingRequiredCredential = credentials.some(
    (credential) => credential.required && !credential.value,
  );
  return (
    <div className="plugin-detail-scroll">
      <div className="plugin-detail-hero">
        <PluginGlyph plugin={plugin} large />
        <div>
          <h3>{pluginDisplayName(plugin)}</h3>
          <p>{plugin.interface?.developerName ?? marketplaceDisplayName(marketplace)}</p>
        </div>
      </div>
      <p className="plugin-detail-description">{detail?.description ?? plugin.interface?.longDescription ?? pluginDescription(plugin)}</p>
      <div className="plugin-detail-badges">
        {plugin.installed && <span className="positive"><Check size={11} /> 已安装</span>}
        {pluginEnabled && <span><ShieldCheck size={11} /> 已启用</span>}
        {plugin.installed && missingRequiredCredential && <span className="warning"><KeyRound size={11} /> 缺少凭据</span>}
        {plugin.version && <span>v{plugin.version}</span>}
      </div>
      <div className="plugin-detail-actions">
        <button
          className={`button ${plugin.installed && pluginEnabled ? 'secondary' : 'primary'}`}
          disabled={mutationKey !== null || plugin.availability !== 'AVAILABLE'}
          onClick={onMutate}
        >
          {mutating ? <LoaderCircle className="spin" size={13} /> : plugin.installed ? pluginEnabled ? <CircleOff size={13} /> : <ShieldCheck size={13} /> : <Download size={13} />}
          {plugin.installed ? pluginEnabled ? '停用插件' : '启用插件' : plugin.availability === 'AVAILABLE' ? '下载插件' : '当前不可下载'}
        </button>
        {plugin.installed && (
          <button className="button secondary danger" disabled={mutationKey !== null} onClick={onUninstall}>
            {uninstalling ? <LoaderCircle className="spin" size={13} /> : <Trash2 size={13} />} 卸载插件
          </button>
        )}
      </div>
      {plugin.installed && !pluginEnabled && (
        <p className="plugin-enable-hint">再次启用插件时，其下所有 Skills 与 MCP 都会恢复为默认开启。</p>
      )}
      {loading && <div className="detail-loading"><LoaderCircle className="spin" size={15} /> 正在读取清单…</div>}
      {detail && (
        <>
          {plugin.installed && credentials.length > 0 && (
            <DetailSection icon={<KeyRound size={13} />} title={`凭据 · ${credentials.length}`}>
              <div className="plugin-credential-list">
                {credentials.map((credential) => (
                  <PluginCredentialForm
                    key={`${plugin.id}:${credential.id}`}
                    credential={credential}
                    installed={plugin.installed}
                    busy={mutationKey === `credential:${credential.id}`}
                    disabled={mutationKey !== null}
                    onConfigure={onConfigureCredential}
                  />
                ))}
              </div>
            </DetailSection>
          )}
          {!plugin.installed && <p className="plugin-enable-hint">下载后可配置账号并启用插件。</p>}
          <details className="plugin-advanced-details">
          <summary>包含的能力与高级管理</summary>
          <DetailSection icon={<Sparkles size={13} />} title={`Skills · ${detail.skills.length}`}>
            {detail.skills.length ? detail.skills.map((skill) => {
              const effective = effectiveSkills.find((candidate) =>
                candidate.pluginId === plugin.id
                && ((skill.path !== null && candidate.path === skill.path)
                  || candidate.name === skill.name
                  || candidate.name.endsWith(`:${skill.name}`)),
              );
              const stateLabel = effective ? effective.enabled ? '已启用' : '已停用' : '未加载';
              const busy = effective ? mutationKey === `skill:${effective.path}` : false;
              const displayName = skill.interface?.displayName ?? skill.name;
              return (
                <div
                  className="plugin-mcp-manifest"
                  key={`${skill.name}:${skill.path}`}
                >
                  <div className="plugin-manifest-row">
                    <span className="plugin-contribution-trigger">
                      <code>{displayName}</code>
                    </span>
                    {effective
                      ? <button
                        role="switch"
                        aria-label={`${skill.interface?.displayName ?? skill.name} ${stateLabel}`}
                        aria-checked={effective.enabled}
                        className={`toggle-switch ${effective.enabled ? 'enabled' : ''}`}
                        disabled={!pluginEnabled || busy}
                        title={pluginEnabled ? '单独控制此 Skill 是否参与新线程' : '先启用插件，再启用 Skill'}
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleSkill(effective);
                        }}
                      >
                        {busy ? <LoaderCircle className="spin" size={11} /> : <span />}
                      </button>
                      : <span className="mini-state">未加载</span>}
                  </div>
                </div>
              );
            }) : <p className="manifest-empty">此插件不包含 Skill</p>}
          </DetailSection>
          <DetailSection icon={<Server size={13} />} title={`MCP · ${detail.mcpServers.length}`}>
            {detail.mcpServers.length ? detail.mcpServers.map((name) => {
              const mcpEnabled = pluginPolicy?.enabledMcpServers.includes(name) === true;
              const busy = mutationKey === `mcp-toggle:${name}`;
              return (
                <div
                  className="plugin-mcp-manifest"
                  key={name}
                >
                  <div className="plugin-manifest-row">
                    <span className="plugin-contribution-trigger">
                      <code>{name}</code>
                    </span>
                    <button
                      role="switch"
                      aria-label={`${name} ${mcpEnabled ? '已启用' : '已停用'}`}
                      aria-checked={mcpEnabled}
                      className={`toggle-switch ${mcpEnabled ? 'enabled' : ''}`}
                      disabled={!pluginEnabled || busy}
                      title={pluginEnabled ? '单独控制此 MCP 是否启动' : '先启用插件，再启用 MCP'}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleMcp(name, !mcpEnabled);
                      }}
                    >
                      {busy ? <LoaderCircle className="spin" size={11} /> : <span />}
                    </button>
                  </div>
                </div>
              );
            }) : <p className="manifest-empty">此插件不包含 MCP 服务</p>}
          </DetailSection>
          {uiContributions.length > 0 && (
            <DetailSection icon={<PanelsTopLeft size={13} />} title={`界面扩展 · ${uiContributions.length}`}>
              {uiContributions.map((contribution) => (
                <div className="plugin-ui-contribution" key={contribution.id}>
                  <strong>{pluginUiContributionLabel(contribution)}</strong>
                  <small>{pluginUiContributionLocation(contribution)}</small>
                </div>
              ))}
            </DetailSection>
          )}
          {webMcpTools.length > 0 && (
            <DetailSection icon={<Wrench size={13} />} title={`WebMCP 工具 · ${webMcpTools.length}`}>
              {webMcpTools.map((tool) => (
                <div className="plugin-mcp-manifest" key={tool.id}>
                  <div className="plugin-manifest-row">
                    <span>
                      <strong>{tool.title}</strong>
                      <small><code>{tool.name}</code> · {tool.scope} · {tool.description}</small>
                    </span>
                  </div>
                </div>
              ))}
            </DetailSection>
          )}
          </details>
          {(detail.hooks.length > 0 || hookPreview.errors.length > 0) && (
            <DetailSection icon={<ShieldAlert size={13} />} title={`Stop Hooks · ${detail.hooks.length}`}>
              {hookPreview.errors.length > 0 && (
                <div className="plugin-hook-warning" role="alert">
                  <AlertCircle size={14} />
                  <span>{hookPreview.errors.join('；')}。修正后才能启用插件。</span>
                </div>
              )}
              {hookPreview.hooks.map((preview) => {
                const live = liveHooks.find((hook) => hook.key === preview.key);
                const busy = mutationKey === `hook:${preview.key}`;
                return (
                  <div className="plugin-hook-card" key={preview.key}>
                    <div className="plugin-manifest-row">
                      <span>
                        <strong>{preview.statusMessage ?? '回合结束命令'}</strong>
                        <small>{preview.async ? '异步' : '同步'} · 超时 {preview.timeoutSec} 秒</small>
                      </span>
                      {live ? (
                        <button
                          role="switch"
                          aria-label={`${preview.statusMessage ?? 'Stop Hook'} ${live.enabled ? '已启用' : '已停用'}`}
                          aria-checked={live.enabled}
                          className={`toggle-switch ${live.enabled ? 'enabled' : ''}`}
                          disabled={!pluginEnabled || live.isManaged || busy}
                          title={live.isManaged ? '由管理员策略管理' : '单独控制此 Hook'}
                          onClick={() => onToggleHook(live, !live.enabled)}
                        >
                          {busy ? <LoaderCircle className="spin" size={11} /> : <span />}
                        </button>
                      ) : <span className="mini-state">{plugin.installed ? '随插件停用' : '下载后可管理'}</span>}
                    </div>
                    <code className="plugin-hook-command">{preview.platformCommand}</code>
                    {live && <small className={`hook-trust-state ${live.trustStatus}`}>
                      {hookTrustLabel(live.trustStatus)}
                    </small>}
                  </div>
                );
              })}
            </DetailSection>
          )}
        </>
      )}
    </div>
  );
}

export function PluginCredentialForm({
  credential,
  installed,
  busy,
  disabled,
  onConfigure,
}: {
  credential: PluginCredentialValue;
  installed: boolean;
  busy: boolean;
  disabled: boolean;
  onConfigure: (credentialId: string, value: string | null) => Promise<void>;
}) {
  const [value, setValue] = useState(credential.value ?? '');
  const [revealed, setRevealed] = useState(false);
  useEffect(() => { setValue(credential.value ?? ''); setRevealed(false); }, [credential.value]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) return;
    try {
      await onConfigure(credential.id, value);
      setRevealed(false);
    } catch {
      // Parent keeps the user-facing error visible and the draft intact.
    }
  };
  const clear = async () => {
    if (!await confirmAction(`清除“${credential.label}”？`, { confirmLabel: '清除凭据', danger: true })) return;
    try {
      await onConfigure(credential.id, null);
      setValue('');
    } catch {
      // Parent keeps the user-facing error visible.
    }
  };
  return (
    <form className="plugin-credential-card" onSubmit={(event) => void save(event)}>
      <div className="plugin-credential-heading">
        <span>
          <strong>{credential.label}</strong>
          <small>{credential.description}</small>
        </span>
        <span className={`mini-state ${credential.value ? 'configured' : ''}`}>
          {credential.value ? '已配置' : credential.required ? '必填' : '可选'}
        </span>
      </div>
      <div className="plugin-credential-controls">
        <input
          type={revealed ? "text" : "password"}
          aria-label={`${credential.label} 凭据`}
          autoComplete="off"
          value={value}
          disabled={!installed || disabled}
          placeholder="输入凭据"
          onChange={(event) => setValue(event.target.value)}
        />
        <button type="button" className="button secondary" aria-label={revealed ? "隐藏凭据" : "显示凭据"} aria-pressed={revealed} onClick={() => setRevealed(!revealed)}>{revealed ? "隐藏" : "显示"}</button>
        <button className="button primary" disabled={!installed || disabled || !value.trim()}>
          {busy ? <LoaderCircle className="spin" size={11} /> : <ShieldCheck size={11} />}
          保存
        </button>
        {credential.value && (
          <button
            className="button ghost danger"
            type="button"
            disabled={!installed || disabled}
            onClick={() => void clear()}
          >
            清除
          </button>
        )}
      </div>
      <small className="plugin-credential-scope">
        {installed ? '明文保存在本机，并由同一商城内声明相同凭据键的插件共享。' : '下载插件后才能保存凭据。'}
      </small>
    </form>
  );
}

function HookTrustDialog({
  request,
  onCancel,
  onApprove,
}: {
  request: HookTrustRequest | null;
  onCancel: () => void;
  onApprove: () => void;
}) {
  if (!request) return null;
  const hooks = request.kind === 'plugin'
    ? request.hooks
    : request.preview
      ? [request.preview]
      : [{
          key: request.hook.key,
          eventName: 'stop' as const,
          command: request.hook.handlerType === 'command' ? request.hook.command : '',
          platformCommand: request.hook.handlerType === 'command' ? request.hook.command : '',
          async: request.hook.handlerType === 'command' ? request.hook.async : false,
          timeoutSec: Number(request.hook.timeoutSec),
          statusMessage: request.hook.statusMessage,
          matcher: request.hook.matcher,
        }];
  return (
    <Dialog.Root open onOpenChange={(next) => { if (!next) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay hook-trust-overlay" />
        <Dialog.Content className="hook-trust-dialog" aria-describedby="hook-trust-description">
          <div className="hook-trust-heading">
            <span className="hook-trust-icon"><ShieldAlert size={19} /></span>
            <div>
              <Dialog.Title>信任并启用 Stop Hook</Dialog.Title>
              <Dialog.Description id="hook-trust-description">
                回合完成后，这些命令会以你的本机权限执行。请确认来源和命令内容。
              </Dialog.Description>
            </div>
          </div>
          <div className="hook-trust-list">
            {hooks.map((hook) => (
              <section key={hook.key}>
                <div><strong>{hook.statusMessage ?? '回合结束命令'}</strong><small>{hook.async ? '异步执行' : '同步执行'} · 超时 {hook.timeoutSec} 秒</small></div>
                <pre>{hook.platformCommand}</pre>
              </section>
            ))}
          </div>
          <p className="hook-trust-source">
            来源：{request.kind === 'plugin' ? request.located.marketplace.name : request.hook.sourcePath}
          </p>
          <div className="hook-trust-actions">
            <button className="button secondary" onClick={onCancel}>取消</button>
            <button className="button primary" onClick={onApprove}><ShieldCheck size={13} /> 信任并启用</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function hookTrustLabel(status: PluginHookMetadata['trustStatus']): string {
  if (status === 'trusted') return '已信任';
  if (status === 'managed') return '管理员管理';
  if (status === 'modified') return '命令已变化，需重新确认';
  return '尚未信任';
}

function ContributionDetailView({
  contribution,
}: {
  contribution: ContributionDialogState | null;
}) {
  if (!contribution) {
    return <EmptyState icon={<Boxes size={22} />} title="选择一项能力" description="查看完整内容、配置与运行时工具。" />;
  }
  const enabledLabel = contribution.enabled === null
    ? '未加载'
    : contribution.enabled
      ? '已启用'
      : '已停用';
  return (
    <div className="plugin-detail-scroll">
      <div className="plugin-detail-hero">
        <span className={`capability-icon ${contribution.kind === 'skill' ? 'violet' : 'blue'} capability-detail-glyph`}>
          {contribution.kind === 'skill' ? <Sparkles size={19} /> : <Server size={19} />}
        </span>
        <div>
          <h3>{contribution.name}</h3>
          <p>{contribution.kind === 'skill' ? 'Skill 详情' : 'MCP 详情'} · {enabledLabel}</p>
        </div>
      </div>
      {contribution.kind === 'skill' ? (
        <>
          <DetailSection icon={<FileText size={13} />} title="功能预览">
            <p className="plugin-detail-description">{contribution.description}</p>
          </DetailSection>
          <DetailSection icon={<FileCode2 size={13} />} title="Skill 路径">
            <pre className="terminal-output">{contribution.path}</pre>
          </DetailSection>
          <DetailSection icon={<BookOpen size={13} />} title="SKILL.md">
            <pre className="terminal-output">{contribution.contents}</pre>
          </DetailSection>
        </>
      ) : (
        <>
          <DetailSection icon={<FileCode2 size={13} />} title="MCP 配置路径">
            <pre className="terminal-output">{contribution.path}</pre>
          </DetailSection>
          <DetailSection icon={<KeyRound size={13} />} title="配置参数（明文）">
            <pre className="terminal-output">{contribution.configuration}</pre>
          </DetailSection>
          <DetailSection icon={<Wrench size={13} />} title={`工具预览 · ${contribution.tools.length}`}>
            {contribution.tools.length > 0 ? (
              <div>
                {contribution.tools.map((tool) => (
                  <div className="plugin-mcp-manifest" key={tool.name}>
                    <div className="plugin-manifest-row">
                      <span><code>{tool.name}</code><small>{tool.description}</small></span>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="manifest-empty">当前没有可预览的运行时工具。</p>}
          </DetailSection>
        </>
      )}
    </div>
  );
}

function DetailSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return <section className="plugin-manifest-section"><h4>{icon}{title}</h4>{children}</section>;
}

function pluginUiContributionLabel(contribution: PluginUiContribution): string {
  switch (contribution.type) {
    case 'widget': return '提问框组件';
    case 'page': return `导航页面 · ${contribution.title}`;
    case 'panel': return `详情面板 · ${contribution.title}`;
    case 'action': return `${contribution.placement === 'commandPalette' ? '命令' : contribution.placement === 'threadToolbar' ? '线程' : '输入区'}操作 · ${contribution.title}`;
    case 'card': return `消息卡片 · ${contribution.title}`;
  }
}

function pluginUiContributionLocation(contribution: PluginUiContribution): string {
  switch (contribution.type) {
    case 'widget': return '显示在消息输入区';
    case 'page': return '显示在左侧插件导航';
    case 'panel': return '显示在对话详情面板';
    case 'action': return contribution.placement === 'commandPalette' ? '显示在命令面板' : contribution.placement === 'threadToolbar' ? '显示在线程工具栏' : '显示在消息输入区工具栏';
    case 'card': return '替换匹配的会话消息展示';
  }
}

function SkillsManager({
  skills,
  errors,
  detail,
  mutationKey,
  onToggle,
  onPreview,
}: {
  skills: SkillMetadata[];
  errors: Array<{ path: string; message: string }>;
  detail: Extract<ContributionDialogState, { kind: 'skill' }> | null;
  mutationKey: string | null;
  onToggle: (skill: SkillMetadata) => void;
  onPreview: (skill: SkillMetadata) => void;
}) {
  return (
    <div className="plugin-browser">
      <div className="plugin-card-list" aria-label="Skill 列表">
        {errors.map((error) => <div className="inline-error" key={`${error.path}:${error.message}`}><AlertCircle size={13} /><span>{error.message}</span></div>)}
        {skills.map((skill) => {
          const busy = mutationKey === `skill:${skill.path}`;
          const selected = detail?.path === skill.path;
          return (
            <article
              className={`plugin-card ${selected ? 'selected' : ''}`}
              key={skill.path}
            >
              <button className="plugin-card-main" aria-label={`查看 ${skillDisplayName(skill)} 详情`} onClick={() => onPreview(skill)}>
                <span className="capability-icon violet"><Sparkles size={15} /></span>
                <span className="plugin-card-copy">
                  <span className="plugin-card-title"><strong>{skillDisplayName(skill)}</strong><span className="scope-pill">{skillScopeLabel(skill.scope)}</span>{skill.pluginId && <span className="scope-pill plugin-owned">插件</span>}</span>
                  <span>{skill.interface?.shortDescription ?? skill.shortDescription ?? skill.description}</span>
                  <small title={skill.path}>{skill.path}</small>
                </span>
              </button>
              <button
                role="switch"
                aria-label={`${skillDisplayName(skill)} ${skill.enabled ? '已启用' : '已停用'}`}
                aria-checked={skill.enabled}
                className={`toggle-switch ${skill.enabled ? 'enabled' : ''}`}
                disabled={busy}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggle(skill);
                }}
              >
                {busy ? <LoaderCircle className="spin" size={11} /> : <span />}
              </button>
              <ChevronRight className="plugin-card-chevron" size={14} />
            </article>
          );
        })}
        {!skills.length && <EmptyState icon={<Sparkles size={24} />} title="没有找到 Skill" description="打开项目后刷新，或安装一个包含 Skill 的插件。" />}
      </div>
      <aside className="plugin-detail-pane"><ContributionDetailView contribution={detail} /></aside>
    </div>
  );
}

function McpManager({
  brandName,
  servers,
  detail,
  mutationKey,
  onLogin,
  onToggle,
  onPreview,
}: {
  brandName: string;
  servers: McpDisplayServer[];
  detail: Extract<ContributionDialogState, { kind: 'mcp' }> | null;
  mutationKey: string | null;
  onLogin: (server: McpServerStatus) => void;
  onToggle: (server: McpServerStatus, enabled: boolean) => void;
  onPreview: (server: McpServerStatus, enabled: boolean) => void;
}) {
  return (
    <div className="plugin-browser">
      <div className="plugin-card-list" aria-label={`${brandName} MCP 列表`}>
        {servers.map((server) => {
          const tools = Object.keys(server.tools);
          const needsAuth = server.authStatus === 'notLoggedIn' || server.runtimeStatus === 'authenticationRequired';
          const selected = detail?.name === server.name;
          return (
            <article
              className={`plugin-card ${selected ? 'selected' : ''}`}
              key={server.pluginId ? `${server.pluginId}:${server.name}` : server.name}
            >
              <button className="plugin-card-main" aria-label={`查看 ${server.name} 详情`} onClick={() => onPreview(server, server.enabled)}>
                <span className={`capability-icon ${mcpTone(server.runtimeStatus)}`}><Server size={15} /></span>
                <span className="plugin-card-copy">
                  <span className="plugin-card-title"><strong>{server.name}</strong><McpStatusBadge server={server} />{server.pluginId && <span className="scope-pill plugin-owned">插件提供</span>}</span>
                  <span>{mcpSummary(server)}</span>
                  <small>{tools.length ? `${tools.length} 个工具` : server.declaredOnly ? '工具将在载入后发现' : '没有工具'}</small>
                </span>
              </button>
              {server.pluginId && (
                <button
                  role="switch"
                  aria-label={`${server.name} ${server.enabled ? '已启用' : '已停用'}`}
                  aria-checked={server.enabled}
                  className={`toggle-switch ${server.enabled ? 'enabled' : ''}`}
                  disabled={!server.pluginEnabled || mutationKey === `mcp-toggle:${server.name}`}
                  title={server.pluginEnabled ? '单独控制此 MCP 是否启动' : '先启用插件，再启用 MCP'}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggle(server, !server.enabled);
                  }}
                >
                  {mutationKey === `mcp-toggle:${server.name}` ? <LoaderCircle className="spin" size={11} /> : <span />}
                </button>
              )}
              {server.enabled && needsAuth && (
                <button
                  className="button secondary"
                  disabled={mutationKey === `mcp:${server.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onLogin(server);
                  }}
                >
                  {mutationKey === `mcp:${server.name}` ? <LoaderCircle className="spin" size={12} /> : <KeyRound size={12} />} 连接
                </button>
              )}
              <ChevronRight className="plugin-card-chevron" size={14} />
            </article>
          );
        })}
        {!servers.length && <EmptyState icon={<PlugZap size={24} />} title="还没有 MCP 服务" description={`安装包含 MCP 的插件，或在隔离的 ${brandName} 配置中添加 MCP 后重新读取配置。`} />}
      </div>
      <aside className="plugin-detail-pane"><ContributionDetailView contribution={detail} /></aside>
    </div>
  );
}

function MarketplaceSources({
  brandName,
  sources,
  source,
  refName,
  mutationKey,
  onSourceChange,
  onRefChange,
  onAdd,
  onRemove,
  onEnabledChange,
}: {
  brandName: string;
  sources: ExtensionSource[];
  source: string;
  refName: string;
  mutationKey: string | null;
  onSourceChange: (value: string) => void;
  onRefChange: (value: string) => void;
  onAdd: (event: FormEvent) => void;
  onRemove: (source: ExtensionSource) => void;
  onEnabledChange: (source: ExtensionSource, enabled: boolean) => void;
}) {
  return (
    <div className="sources-page">
      <section className="add-source-card">
        <div><h3>添加商城源</h3><p>支持 GitHub <code>owner/repo</code>、HTTP(S)/SSH Git URL 或本地目录；添加后默认启用目录，但插件仍需单独下载和启用。</p></div>
        <form onSubmit={onAdd}>
          <label><span>来源</span><input aria-label="商城源" value={source} onChange={(event) => onSourceChange(event.target.value)} placeholder="owner/repo 或 https://…" /></label>
          <label className="source-ref"><span>分支（可选）</span><input aria-label="商城源分支" value={refName} onChange={(event) => onRefChange(event.target.value)} placeholder="main" /></label>
          <button className="button primary" disabled={!source.trim() || mutationKey === 'source:add'}>
            {mutationKey === 'source:add' ? <LoaderCircle className="spin" size={12} /> : <Plus size={12} />} 添加
          </button>
        </form>
      </section>
      <div className="source-authorization-note">
        未启用的来源不会获取目录、启动 MCP、加载 Skill 或向线程注入能力。缓存只作为惰性文件保留。
      </div>
      <div className="sources-heading"><div><h3>已添加商城源</h3><p>{brandName} 预置办公插件商城，也显示你手动添加的来源。</p></div></div>
      <div className="source-list">
        {sources.map((sourceEntry) => {
          const enabled = sourceEntry.enabled;
          const toggleBusy = mutationKey === `source:enable:${sourceEntry.name}`;
          return (
            <article className={`source-row ${enabled ? '' : 'disabled-source'}`} key={sourceEntry.name}>
              <span className="capability-icon blue"><Cloud size={15} /></span>
              <div><strong>{sourceEntry.title}</strong><span>{sourceEntry.description}</span>{sourceEntry.source && <code>{sourceEntry.source}</code>}</div>
              <label className="source-authorization-control">
                <input
                  type="checkbox"
                  aria-label={`${sourceEntry.title} 运行时授权`}
                  checked={enabled}
                  disabled={toggleBusy}
                  onChange={(event) => onEnabledChange(sourceEntry, event.target.checked)}
                />
                <span>{toggleBusy ? '应用中…' : enabled ? '已启用' : '未加载'}</span>
              </label>
              {sourceEntry.kind === 'marketplace' && (
                <div className="source-actions">
                {!sourceEntry.preset && <button className="icon-button danger" aria-label={`移除 ${sourceEntry.title}`} disabled={mutationKey === `source:remove:${sourceEntry.name}`} onClick={() => onRemove(sourceEntry)}><Trash2 size={14} /></button>}
                </div>
              )}
            </article>
          );
        })}
        {!sources.length && <EmptyState icon={<Cloud size={24} />} title="还没有商城源" description="办公商城正在初始化；也可以在上方手动添加其他来源。" />}
      </div>
    </div>
  );
}

function PluginGlyph({ plugin, large = false }: { plugin: PluginSummary; large?: boolean }) {
  const color = safeBrandColor(plugin.interface?.brandColor);
  return <span className={`plugin-glyph ${large ? 'large' : ''}`} style={color ? { '--plugin-color': color } as React.CSSProperties : undefined}><PackageOpen size={large ? 22 : 17} /></span>;
}

function pluginPolicyEnabled(
  pluginId: string,
  policies: ExtensionPluginPolicy[],
): boolean {
  return policies.find((policy) => policy.pluginId === pluginId)?.enabled === true;
}

function McpStatusBadge({ server }: { server: McpDisplayServer }) {
  if (server.declaredOnly) {
    const label = !server.pluginEnabled
      ? '未启用'
      : server.enabled
        ? '未载入'
        : '已停用';
    return <span className="mcp-status declared"><CircleOff size={10} />{label}</span>;
  }
  const { runtimeStatus: status } = server;
  const loaded = status === null && (
    server.serverInfo !== null
    || Object.keys(server.tools).length > 0
    || server.resources.length > 0
    || server.resourceTemplates.length > 0
  );
  const label = loaded ? '已载入' : mcpStatusLabel(status);
  return <span className={`mcp-status ${loaded ? 'loaded' : status ?? 'unknown'}`}>{status === 'connected' || loaded ? <Check size={10} /> : status === 'failed' || status === 'authenticationRequired' ? <AlertCircle size={10} /> : <CircleOff size={10} />}{label}</span>;
}

function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return <div className="marketplace-empty">{icon}<strong>{title}</strong><p>{description}</p></div>;
}

function firstLocatedPlugin(response: PluginListResponse): LocatedPlugin | null {
  const featured = new Set(response.featuredPluginIds);
  return flattenPlugins(response).sort((left, right) => compareLocatedPlugins(left, right, featured))[0] ?? null;
}

function compareLocatedPlugins(
  left: LocatedPlugin,
  right: LocatedPlugin,
  featured: Set<string>,
): number {
  const featuredDelta = Number(featured.has(right.plugin.id)) - Number(featured.has(left.plugin.id));
  if (featuredDelta) return featuredDelta;
  const installedDelta = Number(right.plugin.installed) - Number(left.plugin.installed);
  if (installedDelta) return installedDelta;
  return pluginDisplayName(left.plugin).localeCompare(pluginDisplayName(right.plugin), 'zh-CN');
}

function flattenPlugins(response: PluginListResponse): LocatedPlugin[] {
  return response.marketplaces.flatMap((marketplace) =>
    marketplace.plugins.map((plugin) => ({
      marketplace,
      plugin,
      location: {
        pluginId: plugin.id,
        marketplaceName: marketplace.name,
        marketplacePath: marketplace.path,
        pluginName: plugin.name,
      },
    })),
  );
}

function filterSkills(
  response: SkillsListResponse,
  query: string,
): SkillMetadata[] {
  const byPath = new Map<string, SkillMetadata>();
  for (const entry of response.data) for (const skill of entry.skills) byPath.set(skill.path, skill);
  const needle = normalizeSearch(query);
  return [...byPath.values()]
    .filter((skill) => !needle || normalizeSearch(`${skillDisplayName(skill)} ${skill.name} ${skill.description} ${skill.path}`).includes(needle))
    .sort((left, right) => Number(right.enabled) - Number(left.enabled) || skillDisplayName(left).localeCompare(skillDisplayName(right), 'zh-CN'));
}

function mergeDeclaredMcpServers(
  runtimeServers: McpServerStatus[],
  policies: ExtensionPluginPolicy[],
  locatedPlugins: LocatedPlugin[],
): McpDisplayServer[] {
  const policiesByPluginId = new Map(policies.map((policy) => [policy.pluginId, policy]));
  const installedPluginIds = new Set(
    locatedPlugins
      .filter(({ plugin }) => plugin.installed)
      .map(({ plugin }) => plugin.id),
  );
  const merged = runtimeServers.map((server): McpDisplayServer => {
    const policy = server.pluginId ? policiesByPluginId.get(server.pluginId) : undefined;
    const pluginEnabled = policy?.enabled ?? true;
    const enabled = server.pluginId
      ? pluginEnabled && policy?.enabledMcpServers.includes(server.name) === true
      : true;
    return { ...server, declaredOnly: false, pluginEnabled, enabled };
  });
  const runtimeKeys = new Set(merged.map(mcpIdentity));

  for (const policy of policies) {
    if (!installedPluginIds.has(policy.pluginId)) continue;
    for (const name of policy.mcpServers) {
      const identity = mcpIdentity({ name, pluginId: policy.pluginId });
      if (runtimeKeys.has(identity)) continue;
      const pluginEnabled = policy.enabled;
      merged.push({
        name,
        runtimeStatus: null,
        pluginId: policy.pluginId,
        serverInfo: null,
        tools: {},
        resources: [],
        resourceTemplates: [],
        authStatus: 'unknown',
        declaredOnly: true,
        pluginEnabled,
        enabled: pluginEnabled && policy.enabledMcpServers.includes(name),
      });
      runtimeKeys.add(identity);
    }
  }

  return merged;
}

function mcpIdentity(server: Pick<McpServerStatus, 'name' | 'pluginId'>): string {
  return `${server.pluginId ?? ''}\u0000${server.name}`;
}

function filterMcp(
  servers: McpDisplayServer[],
  query: string,
): McpDisplayServer[] {
  const needle = normalizeSearch(query);
  return servers
    .filter((server) => !needle || normalizeSearch(`${server.name} ${Object.keys(server.tools).join(' ')}`).includes(needle));
}

function pluginDisplayName(plugin: PluginSummary): string {
  return plugin.interface?.displayName ?? plugin.name;
}

function pluginDescription(plugin: PluginSummary): string {
  return plugin.interface?.shortDescription ?? plugin.interface?.longDescription ?? '包含可复用的能力。';
}

function pluginCapabilitySummary(plugin: PluginSummary): string {
  if (plugin.interface?.capabilities.length) return plugin.interface.capabilities.slice(0, 3).join(' · ');
  return plugin.installed ? '已安装' : '可安装';
}

function marketplaceDisplayName(marketplace: PluginMarketplaceEntry): string {
  return marketplace.interface?.displayName ?? marketplace.name;
}

function skillDisplayName(skill: SkillMetadata): string {
  return skill.interface?.displayName ?? skill.name;
}

function skillScopeLabel(scope: SkillMetadata['scope']): string {
  return { user: '用户', repo: '项目', system: '系统', admin: '管理' }[scope];
}

function mcpStatusLabel(status: McpServerStatus['runtimeStatus']): string {
  if (!status) return '未载入';
  return {
    notStarted: '未启动',
    starting: '连接中',
    connected: '已连接',
    authenticationRequired: '需要认证',
    failed: '连接失败',
    cancelled: '已取消',
    disabled: '已停用',
  }[status];
}

function mcpTone(status: McpServerStatus['runtimeStatus']): string {
  if (status === 'connected') return 'green';
  if (status === 'failed' || status === 'authenticationRequired') return 'amber';
  return 'blue';
}

function mcpSummary(server: McpDisplayServer): string {
  if (server.declaredOnly) {
    if (!server.pluginEnabled) return '插件已下载；启用插件后加载此 MCP';
    if (!server.enabled) return '插件已启用；开启此 MCP 后加载';
    return '配置已启用；等待运行时载入';
  }
  const toolCount = Object.keys(server.tools).length;
  const inventory = [`${toolCount} 个工具`];
  if (server.resources.length) inventory.push(`${server.resources.length} 个资源`);
  if (server.resourceTemplates.length) inventory.push(`${server.resourceTemplates.length} 个资源模板`);
  if (server.authStatus === 'oAuth') inventory.push('OAuth');
  else if (server.authStatus === 'bearerToken') inventory.push('Token');
  else if (server.authStatus === 'notLoggedIn') inventory.push('尚未认证');
  return inventory.join(' · ');
}

function sameLocation(left: PluginLocationInput, right: PluginLocationInput): boolean {
  return left.marketplaceName === right.marketplaceName && left.marketplacePath === right.marketplacePath && left.pluginName === right.pluginName;
}

function normalizeSearch(value: string): string {
  return value.toLocaleLowerCase('zh-CN').replace(/[\s\p{P}\p{S}]+/gu, '');
}

function safeBrandColor(value: string | null | undefined): string | null {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
