import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginListResponse } from '../../src/generated/protocol/typescript/v2/PluginListResponse';
import type { SkillsListResponse } from '../../src/generated/protocol/typescript/v2/SkillsListResponse';
import { PluginMarketplaceDialog } from '../../src/renderer/components/PluginMarketplaceDialog';
import { useAppStore } from '../../src/renderer/state/store';
import type { WhaleApi } from '../../src/shared/types';
import type { ExtensionPolicySnapshot } from '../../src/shared/extension-policy';

const originalState = useAppStore.getState();
const originalWhale = window.whale;

const pluginResponse = {
  marketplaces: [
    {
      name: 'fixture-marketplace',
      path: '/fixture/marketplace.json',
      interface: { displayName: 'Fixture Marketplace' },
      plugins: [
        {
          id: 'fixture-plugin',
          remotePluginId: null,
          version: '1.0.0',
          localVersion: null,
          name: 'fixture-tools',
          shareContext: null,
          source: { type: 'local', path: '/fixture/plugin' },
          installed: false,
          installedAt: null,
          enabled: false,
          installPolicy: 'AVAILABLE',
          installPolicySource: null,
          mustShowInstallationInterstitial: true,
          authPolicy: 'ON_USE',
          availability: 'AVAILABLE',
          disabledReason: null,
          eligiblePlanTypes: null,
          interface: {
            displayName: 'Fixture Tools',
            shortDescription: '测试插件',
            longDescription: '测试插件详情',
            developerName: 'Whale Test Lab',
            category: 'Developer Tools',
            capabilities: ['Skills', 'MCP'],
            websiteUrl: null,
            privacyPolicyUrl: null,
            termsOfServiceUrl: null,
            defaultPrompt: null,
            brandColor: '#176b69',
            composerIcon: null,
            composerIconUrl: null,
            logo: null,
            logoDark: null,
            logoUrl: null,
            logoUrlDark: null,
            screenshots: [],
            screenshotUrls: [],
          },
          keywords: ['fixture'],
        },
      ],
    },
  ],
  marketplaceLoadErrors: [],
  featuredPluginIds: ['fixture-plugin'],
} as unknown as PluginListResponse;

const skillResponse = {
  data: [
    {
      cwd: '/workspace/project',
      errors: [],
      skills: [
        {
          name: 'fixture-skill',
          description: '可切换的 Skill',
          shortDescription: '可切换的 Skill',
          path: '/fixture/skills/fixture-skill/SKILL.md',
          scope: 'user',
          enabled: true,
          pluginId: 'fixture-plugin',
        },
      ],
    },
  ],
} as SkillsListResponse;

const extensionPolicy: ExtensionPolicySnapshot = {
  sources: [
    {
      name: 'fixture-marketplace',
      title: 'Fixture Marketplace',
      description: '/fixture/marketplace.json',
      kind: 'marketplace',
      source: '/fixture/marketplace.json',
      refName: null,
      enabled: true,
    },
  ],
  plugins: [
    {
      pluginId: 'fixture-plugin',
      marketplaceName: 'fixture-marketplace',
      enabled: true,
      mcpServers: ['fixture-mcp'],
      enabledMcpServers: ['fixture-mcp'],
      credentials: [],
    },
  ],
  enabledSkillPaths: [],
};

beforeEach(() => {
  const whale = {
    plugins: {
      list: vi.fn().mockResolvedValue(pluginResponse),
      read: vi.fn().mockResolvedValue({
        plugin: {
          marketplaceName: 'fixture-marketplace',
          marketplacePath: '/fixture/marketplace.json',
          summary: pluginResponse.marketplaces[0].plugins[0],
          shareUrl: null,
          description: '测试插件详情',
          skills: [],
          hooks: [],
          apps: [],
          appTemplates: [],
          mcpServers: ['fixture-mcp'],
          scheduledTasks: null,
        },
      }),
      contributions: vi.fn().mockResolvedValue({
        skills: [{
          name: 'fixture-skill',
          path: '/fixture/skills/fixture-skill/SKILL.md',
          contents: '# Fixture Skill\n\nUse the fixture safely.',
        }],
        mcp: {
          path: '/fixture/plugin/.mcp.json',
          contents: '{"mcpServers":{"fixture-mcp":{}}}',
          servers: [{
            name: 'fixture-mcp',
            config: {
              url: 'https://fixture.example/mcp',
              http_headers: { Authorization: 'Bearer plaintext-fixture-token' },
            },
          }],
        },
        uiContributions: [
          {
            id: 'fixture-composer',
            type: 'widget',
            placement: 'composer',
            entryUrl: 'whale-plugin://plugin/fixture-plugin/ui/composer.html',
            order: 10,
          },
          {
            id: 'fixture-tool-card',
            type: 'card',
            placement: 'message',
            entryUrl: 'whale-plugin://plugin/fixture-plugin/ui/tool-card.html',
            title: 'Fixture result',
            itemTypes: ['mcpToolCall'],
            server: 'fixture-mcp',
            tools: ['inspect_fixture'],
            order: 0,
          },
        ],
        webMcp: null,
      }),
      credentials: vi.fn().mockResolvedValue({
        pluginId: 'fixture-plugin',
        credentials: [],
      }),
      configureCredential: vi.fn().mockResolvedValue({
        pluginId: 'fixture-plugin',
        credentials: [],
      }),
      descriptors: vi.fn().mockResolvedValue([]),
      callMcp: vi.fn(),
      install: vi.fn().mockResolvedValue({ authPolicy: 'ON_USE', appsNeedingAuth: [] }),
      uninstall: vi.fn().mockResolvedValue(undefined),
      setEnabled: vi.fn().mockResolvedValue(extensionPolicy),
    },
    hooks: {
      previewPlugin: vi.fn().mockResolvedValue({
        pluginId: 'fixture-plugin', sourcePath: '/fixture/plugin/hooks/hooks.json',
        digest: null, hooks: [], errors: [], supported: true,
      }),
      list: vi.fn().mockResolvedValue({ data: [] }),
      setEnabled: vi.fn().mockResolvedValue({ data: [] }),
    },
    skills: {
      list: vi.fn().mockResolvedValue(skillResponse),
      setEnabled: vi.fn().mockResolvedValue({ effectiveEnabled: false }),
    },
    mcp: {
      list: vi.fn().mockResolvedValue({
        data: [
          {
            name: 'fixture-mcp',
            runtimeStatus: 'authenticationRequired',
            pluginId: 'fixture-plugin',
            serverInfo: null,
            tools: { inspect_fixture: {} },
            resources: [],
            resourceTemplates: [],
            authStatus: 'notLoggedIn',
          },
        ],
        nextCursor: null,
      }),
      login: vi.fn().mockResolvedValue({ started: true }),
      setEnabled: vi.fn().mockResolvedValue(extensionPolicy),
      reload: vi.fn().mockResolvedValue(undefined),
    },
    models: {
      list: vi.fn(),
      capabilities: vi.fn().mockResolvedValue({
        namespaceTools: false,
        imageGeneration: false,
        webSearch: true,
      }),
    },
    marketplaces: {
      add: vi.fn(),
      remove: vi.fn(),
      upgrade: vi.fn().mockResolvedValue({
        selectedMarketplaces: ['fixture-marketplace'],
        upgradedRoots: ['/fixture/marketplace'],
        errors: [],
      }),
      sources: vi.fn().mockResolvedValue(extensionPolicy),
      setEnabled: vi.fn().mockImplementation((marketplaceName: string, enabled: boolean) =>
        Promise.resolve({
          ...extensionPolicy,
          sources: extensionPolicy.sources.map((source) =>
            source.name === marketplaceName ? { ...source, enabled } : source,
          ),
        }),
      ),
    },
    events: { subscribe: vi.fn().mockReturnValue(() => undefined) },
  } as unknown as WhaleApi;
  Object.defineProperty(window, 'whale', { configurable: true, value: whale });
  useAppStore.setState(
    {
      ...originalState,
      pluginMarketplaceOpen: true,
      projects: [
        { id: 'project-1', name: 'project', path: '/workspace/project', lastOpenedAt: 0 },
      ],
      selectedProjectId: 'project-1',
      selectedThreadId: 'thread-1',
      models: [{
        id: 'fixture-model',
        model: 'fixture-model',
        displayName: 'Fixture Model',
        description: 'Fixture model with vision',
        isDefault: true,
        inputModalities: ['text', 'image'],
      }],
    },
    true,
  );
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'whale', { configurable: true, value: originalWhale });
  useAppStore.setState(originalState, true);
});

describe('PluginMarketplaceDialog', () => {
  it('previews Stop commands and requires trust before enabling the plugin', async () => {
    const installedPlugin = {
      ...pluginResponse.marketplaces[0].plugins[0],
      installed: true,
      enabled: false,
    };
    const disabledPolicy = {
      ...extensionPolicy,
      plugins: extensionPolicy.plugins.map((plugin) => ({ ...plugin, enabled: false })),
    };
    vi.mocked(window.whale.plugins.list).mockResolvedValue({
      ...pluginResponse,
      marketplaces: [{ ...pluginResponse.marketplaces[0], plugins: [installedPlugin] }],
    });
    vi.mocked(window.whale.marketplaces.sources).mockResolvedValue(disabledPolicy);
    vi.mocked(window.whale.plugins.read).mockResolvedValue({
      plugin: {
        marketplaceName: 'fixture-marketplace', marketplacePath: '/fixture/marketplace.json',
        summary: installedPlugin, shareUrl: null, description: '测试 Hook', skills: [],
        hooks: [{ key: 'fixture-plugin:hooks/hooks.json:stop:0:0', eventName: 'stop' }],
        apps: [], appTemplates: [], mcpServers: [], scheduledTasks: null,
      },
    } as never);
    vi.mocked(window.whale.hooks.previewPlugin).mockResolvedValue({
      pluginId: 'fixture-plugin', sourcePath: '/fixture/plugin/hooks/hooks.json',
      digest: `sha256:${'a'.repeat(64)}`, supported: true, errors: [],
      hooks: [{
        key: 'fixture-plugin:hooks/hooks.json:stop:0:0', eventName: 'stop',
        command: 'node hooks/after-turn.mjs', platformCommand: 'node hooks/after-turn.mjs',
        async: false, timeoutSec: 12, statusMessage: '整理本轮结果', matcher: null,
      }],
    });

    render(<PluginMarketplaceDialog />);
    expect(await screen.findByText('Stop Hooks · 1')).toBeInTheDocument();
    expect(screen.getByText('node hooks/after-turn.mjs')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '启用插件' }));
    expect(await screen.findByRole('heading', { name: '信任并启用 Stop Hook' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '信任并启用' }));
    await waitFor(() => expect(window.whale.plugins.setEnabled).toHaveBeenCalledWith({
      pluginId: 'fixture-plugin', marketplaceName: 'fixture-marketplace',
      marketplacePath: '/fixture/marketplace.json', pluginName: 'fixture-tools', enabled: true,
      cwd: '/workspace/project', approvedHookDigest: `sha256:${'a'.repeat(64)}`,
    }));
  });

  it('renders host credential contributions and saves secrets through Whale IPC', async () => {
    const installedPlugin = {
      ...pluginResponse.marketplaces[0].plugins[0],
      installed: true,
      enabled: false,
    };
    const credential = {
      id: 'aihub-token',
      key: 'aihub/token',
      credentialType: 'bearerToken' as const,
      label: 'AIHub Token',
      description: '访问小鲸服务',
      env: 'AIHUB_MCP_TOKEN',
      required: true,
      scope: 'marketplace' as const,
      mcpServers: ['fixture-mcp'],
      value: null,
    };
    vi.mocked(window.whale.plugins.list).mockResolvedValue({
      ...pluginResponse,
      marketplaces: [{ ...pluginResponse.marketplaces[0], plugins: [installedPlugin] }],
    });
    vi.mocked(window.whale.plugins.credentials).mockResolvedValue({
      pluginId: 'fixture-plugin',
      credentials: [credential],
    });
    vi.mocked(window.whale.plugins.configureCredential).mockResolvedValue({
      pluginId: 'fixture-plugin',
      credentials: [{ ...credential, value: 'fixture-secret' }],
    });

    render(<PluginMarketplaceDialog />);

    const input = await screen.findByLabelText('AIHub Token 凭据');
    expect(screen.getByText('缺少凭据')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'fixture-secret' } });
    // React 状态提交与点击之间存在竞态（慢环境必现），先确认按钮已随输入解除禁用。
    const saveButton = screen.getByRole('button', { name: '保存' });
    await waitFor(() => expect(saveButton).toBeEnabled(), { timeout: 5_000 });
    fireEvent.click(saveButton);

    await waitFor(() => expect(window.whale.plugins.configureCredential).toHaveBeenCalledWith({
      pluginId: 'fixture-plugin',
      marketplaceName: 'fixture-marketplace',
      marketplacePath: '/fixture/marketplace.json',
      pluginName: 'fixture-tools',
      credentialId: 'aihub-token',
      value: 'fixture-secret',
    }));
    expect(await screen.findByText('已配置')).toBeInTheDocument();
    expect(input).toHaveValue('fixture-secret');
  });

  it('keeps contribution rows in the plugin detail pane static and compact', async () => {
    const installedPlugin = {
      ...pluginResponse.marketplaces[0].plugins[0],
      installed: true,
      enabled: true,
    };
    vi.mocked(window.whale.plugins.list).mockResolvedValue({
      ...pluginResponse,
      marketplaces: [{ ...pluginResponse.marketplaces[0], plugins: [installedPlugin] }],
    });
    vi.mocked(window.whale.plugins.read).mockResolvedValue({
      plugin: {
        marketplaceName: 'fixture-marketplace',
        marketplacePath: '/fixture/marketplace.json',
        summary: installedPlugin,
        shareUrl: null,
        description: '测试插件详情',
        skills: [{
          name: 'fixture-skill-with-a-name-that-needs-ellipsis',
          description: '插件内不应展开的 Skill 详情',
          shortDescription: '插件内不应展开的 Skill 详情',
          interface: null,
          path: '/fixture/skills/fixture-skill/SKILL.md',
          enabled: true,
        }],
        hooks: [],
        apps: [],
        appTemplates: [],
        mcpServers: ['fixture-mcp'],
        scheduledTasks: null,
      },
    });

    render(<PluginMarketplaceDialog />);

    const skillName = await screen.findByText('fixture-skill-with-a-name-that-needs-ellipsis');
    const mcpName = await screen.findByText('fixture-mcp');
    expect(skillName.closest('.plugin-mcp-manifest')).toBeInTheDocument();
    expect(mcpName.closest('.plugin-mcp-manifest')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /fixture-(skill|mcp).*详情/ })).not.toBeInTheDocument();
    expect(screen.queryByText('inspect_fixture')).not.toBeInTheDocument();
    expect(screen.queryByText('插件内不应展开的 Skill 详情')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('包含的能力与高级管理'));
    expect(screen.getByText('界面扩展 · 2')).toBeInTheDocument();
    expect(screen.getByText('提问框组件')).toBeInTheDocument();
    expect(screen.getByText('显示在消息输入区')).toBeInTheDocument();
    expect(screen.getByText('消息卡片 · Fixture result')).toBeInTheDocument();
    expect(screen.getByText('替换匹配的会话消息展示')).toBeInTheDocument();
    fireEvent.click(skillName);
    fireEvent.click(mcpName);
    expect(screen.queryByRole('dialog', { name: /fixture/ })).not.toBeInTheDocument();
  });

  it('shows Skills and MCP details in panes aligned with the plugin page', async () => {
    render(<PluginMarketplaceDialog />);
    const tabs = within(screen.getByRole('navigation', { name: '插件商城分类' }));

    fireEvent.click(tabs.getByRole('button', { name: /Skills/ }));
    fireEvent.click(await screen.findByRole('button', { name: '查看 fixture-skill 详情' }));
    await waitFor(() => expect(screen.getByText(/Use the fixture safely/)).toBeInTheDocument());
    expect(screen.getByLabelText('Skill 列表')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'fixture-skill' })).not.toBeInTheDocument();

    fireEvent.click(tabs.getByRole('button', { name: /^MCP/ }));
    fireEvent.click(await screen.findByRole('button', { name: '查看 fixture-mcp 详情' }));
    await waitFor(() => expect(screen.getByText(/Bearer plaintext-fixture-token/)).toBeInTheDocument());
    expect(screen.getByLabelText(/MCP 列表$/)).toBeInTheDocument();
    expect(screen.getAllByText('inspect_fixture').length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog', { name: 'fixture-mcp' })).not.toBeInTheDocument();
  });

  it('treats a server inventory with no runtime status as loaded', async () => {
    vi.mocked(window.whale.mcp.list).mockResolvedValue({
      data: [{
        name: 'fixture-mcp',
        runtimeStatus: null,
        pluginId: 'fixture-plugin',
        serverInfo: {
          name: 'fixture-mcp',
          title: null,
          version: '1.0.0',
          description: null,
          icons: null,
          websiteUrl: null,
        },
        tools: {
          inspect_fixture: {
            name: 'inspect_fixture',
            inputSchema: { type: 'object' },
          },
        },
        resources: [],
        resourceTemplates: [],
        authStatus: 'unsupported',
      }],
      nextCursor: null,
    });

    render(<PluginMarketplaceDialog />);
    const tabs = within(screen.getByRole('navigation', { name: '插件商城分类' }));
    fireEvent.click(tabs.getByRole('button', { name: /^MCP/ }));

    expect(await screen.findByText('已载入')).toBeInTheDocument();
    expect(screen.queryByText('未载入')).not.toBeInTheDocument();
  });

  it('does not expose an independent Tools page', async () => {
    vi.mocked(window.whale.mcp.list).mockResolvedValue({
      data: [{
        name: 'standalone-mcp',
        runtimeStatus: null,
        pluginId: null,
        serverInfo: null,
        tools: {
          standalone_search: {
            name: 'standalone_search',
            description: '独立 MCP 搜索工具',
            inputSchema: { type: 'object' },
          },
        },
        resources: [],
        resourceTemplates: [],
        authStatus: 'bearerToken',
      }],
      nextCursor: null,
    });

    render(<PluginMarketplaceDialog />);
    const tabs = within(screen.getByRole('navigation', { name: '插件商城分类' }));
    await screen.findAllByText('Fixture Tools');
    expect(tabs.queryByRole('button', { name: /^工具/ })).not.toBeInTheDocument();
    expect(screen.queryByText('standalone_search')).not.toBeInTheDocument();
  });

  it('uses skills/list as the effective state in plugin details', async () => {
    vi.mocked(window.whale.skills.list).mockResolvedValue({
      data: [{
        ...skillResponse.data[0],
        skills: [{ ...skillResponse.data[0].skills[0], enabled: false }],
      }],
    });
    vi.mocked(window.whale.plugins.read).mockResolvedValue({
      plugin: {
        marketplaceName: 'fixture-marketplace',
        marketplacePath: '/fixture/marketplace.json',
        summary: pluginResponse.marketplaces[0].plugins[0],
        shareUrl: null,
        description: '测试插件详情',
        skills: [{
          name: 'fixture-skill',
          description: '可切换的 Skill',
          shortDescription: '可切换的 Skill',
          interface: null,
          path: '/fixture/skills/fixture-skill/SKILL.md',
          enabled: true,
        }],
        hooks: [],
        apps: [],
        appTemplates: [],
        mcpServers: ['fixture-mcp'],
        scheduledTasks: null,
      },
    });

    render(<PluginMarketplaceDialog />);

    const skillName = await screen.findByText('fixture-skill');
    const detailRow = skillName.closest('.plugin-manifest-row');
    const skillSwitch = within(detailRow as HTMLElement).getByRole('switch', {
      name: 'fixture-skill 已停用',
    });
    expect(skillSwitch).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(skillSwitch);
    await waitFor(() => expect(window.whale.skills.setEnabled).toHaveBeenCalledWith({
      path: '/fixture/skills/fixture-skill/SKILL.md',
      scope: 'user',
      pluginId: 'fixture-plugin',
      enabled: true,
    }));
  });

  it('loads the catalog and manages both Skills and MCP connections', async () => {
    render(<PluginMarketplaceDialog />);

    expect((await screen.findAllByText('Fixture Tools')).length).toBeGreaterThan(0);
    expect(document.querySelector('.plugin-glyph svg')).toBeInTheDocument();
    expect(screen.getByText('精选')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '全部刷新' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '全部刷新' }));
    await waitFor(() => expect(window.whale.marketplaces.upgrade).toHaveBeenCalledWith());
    expect(window.whale.mcp.reload).toHaveBeenCalledWith();
    expect(window.whale.plugins.list).toHaveBeenCalledWith({
      cwd: '/workspace/project',
      forceRefetch: true,
    });

    const tabs = within(screen.getByRole('navigation', { name: '插件商城分类' }));
    fireEvent.click(tabs.getByRole('button', { name: /Skills/ }));
    const skillSwitch = await screen.findByRole('switch', { name: 'fixture-skill 已启用' });
    expect(skillSwitch).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(skillSwitch);
    await waitFor(() =>
      expect(window.whale.skills.setEnabled).toHaveBeenCalledWith({
        path: '/fixture/skills/fixture-skill/SKILL.md',
        scope: 'user',
        pluginId: 'fixture-plugin',
        enabled: false,
      }),
    );

    fireEvent.click(tabs.getByRole('button', { name: /^MCP/ }));
    fireEvent.click(await screen.findByRole('button', { name: '查看 fixture-mcp 详情' }));
    expect(await screen.findByText('inspect_fixture')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '连接' }));
    await waitFor(() =>
      expect(window.whale.mcp.login).toHaveBeenCalledWith({
        name: 'fixture-mcp',
      }),
    );

    expect(screen.queryByText('view_image')).not.toBeInTheDocument();
    expect(screen.queryByText('web_search')).not.toBeInTheDocument();
  });

  it('treats a user-added source toggle as runtime authorization', async () => {
    render(<PluginMarketplaceDialog />);

    expect((await screen.findAllByText('Fixture Tools')).length).toBeGreaterThan(0);

    const tabs = within(screen.getByRole('navigation', { name: '插件商城分类' }));
    fireEvent.click(tabs.getByRole('button', { name: /商城源/ }));
    const sourceToggle = await screen.findByRole('checkbox', {
      name: 'Fixture Marketplace 运行时授权',
    });
    expect(sourceToggle).toBeChecked();
    fireEvent.click(sourceToggle);
    await waitFor(() =>
      expect(window.whale.marketplaces.setEnabled).toHaveBeenCalledWith(
        'fixture-marketplace',
        false,
      ),
    );
  });

  it('starts with no preset marketplaces or built-in extension sources', async () => {
    vi.mocked(window.whale.plugins.list).mockResolvedValue({
      marketplaces: [],
      marketplaceLoadErrors: [],
      featuredPluginIds: [],
    });
    vi.mocked(window.whale.skills.list).mockResolvedValue({ data: [] });
    vi.mocked(window.whale.mcp.list).mockResolvedValue({ data: [], nextCursor: null });
    vi.mocked(window.whale.marketplaces.sources).mockResolvedValue({
      sources: [],
      plugins: [],
      enabledSkillPaths: [],
    });

    render(<PluginMarketplaceDialog />);

    const tabs = within(screen.getByRole('navigation', { name: '插件商城分类' }));
    fireEvent.click(tabs.getByRole('button', { name: /商城源/ }));

    expect(await screen.findByText('还没有商城源')).toBeInTheDocument();
    expect(screen.queryByText('OpenAI 官方远程商城')).not.toBeInTheDocument();
    expect(screen.queryByText('Codex 内置 Skills')).not.toBeInTheDocument();
    expect(screen.queryByText('ChatGPT Apps')).not.toBeInTheDocument();
  });

  it('uses Whale policy as the authoritative plugin enabled state', async () => {
    const installedPlugin = {
      ...pluginResponse.marketplaces[0].plugins[0],
      installed: true,
      enabled: true,
    };
    const disabledPolicy = {
      ...extensionPolicy,
      plugins: extensionPolicy.plugins.map((plugin) => ({ ...plugin, enabled: false })),
    };
    vi.mocked(window.whale.plugins.list).mockResolvedValue({
      ...pluginResponse,
      marketplaces: [{ ...pluginResponse.marketplaces[0], plugins: [installedPlugin] }],
    });
    vi.mocked(window.whale.plugins.setEnabled).mockResolvedValue(disabledPolicy);
    vi.mocked(window.whale.marketplaces.sources)
      .mockResolvedValueOnce(extensionPolicy)
      .mockResolvedValue(disabledPolicy);

    render(<PluginMarketplaceDialog />);

    const disableButtons = await screen.findAllByRole('button', { name: /停用/ });
    fireEvent.click(disableButtons[0]);
    await waitFor(() =>
      expect(window.whale.plugins.setEnabled).toHaveBeenCalledWith({
        pluginId: 'fixture-plugin',
        marketplaceName: 'fixture-marketplace',
        marketplacePath: '/fixture/marketplace.json',
        pluginName: 'fixture-tools',
        cwd: '/workspace/project',
        enabled: false,
      }),
    );
    expect(await screen.findAllByRole('button', { name: /启用/ })).not.toHaveLength(0);
  });

  it('can enable a declared MCP before that server has started', async () => {
    const enabledPlugin = {
      ...pluginResponse.marketplaces[0].plugins[0],
      installed: true,
      enabled: true,
    };
    vi.mocked(window.whale.plugins.list).mockResolvedValue({
      ...pluginResponse,
      marketplaces: [{
        ...pluginResponse.marketplaces[0],
        plugins: [enabledPlugin],
      }],
    });
    vi.mocked(window.whale.plugins.read).mockResolvedValue({
      plugin: {
        marketplaceName: 'fixture-marketplace',
        marketplacePath: '/fixture/marketplace.json',
        summary: enabledPlugin,
        shareUrl: null,
        description: '测试插件详情',
        skills: [],
        hooks: [],
        apps: [],
        appTemplates: [],
        mcpServers: ['fixture-mcp'],
        scheduledTasks: null,
      },
    });
    vi.mocked(window.whale.mcp.list).mockResolvedValue({ data: [], nextCursor: null });
    const disabledPolicy = {
      ...extensionPolicy,
      plugins: extensionPolicy.plugins.map((plugin) => ({
        ...plugin,
        enabledMcpServers: [],
      })),
    };
    vi.mocked(window.whale.marketplaces.sources).mockResolvedValue(disabledPolicy);
    vi.mocked(window.whale.mcp.setEnabled).mockResolvedValue(extensionPolicy);

    render(<PluginMarketplaceDialog />);

    expect((await screen.findAllByText('Fixture Tools')).length).toBeGreaterThan(0);
    const mcpSwitch = await screen.findByRole('switch', { name: 'fixture-mcp 已停用' });
    expect(mcpSwitch).toHaveAttribute('aria-checked', 'false');
    expect(mcpSwitch).not.toBeDisabled();
    fireEvent.click(mcpSwitch);
    await waitFor(() => expect(window.whale.mcp.setEnabled).toHaveBeenCalledWith({
      name: 'fixture-mcp',
      pluginId: 'fixture-plugin',
      enabled: true,
    }));
  });

  it('shows a downloaded plugin MCP even when the plugin is disabled', async () => {
    const installedPlugin = {
      ...pluginResponse.marketplaces[0].plugins[0],
      installed: true,
      enabled: false,
    };
    const disabledPolicy = {
      ...extensionPolicy,
      plugins: extensionPolicy.plugins.map((plugin) => ({
        ...plugin,
        enabled: false,
        enabledMcpServers: [],
      })),
    };
    vi.mocked(window.whale.plugins.list).mockResolvedValue({
      ...pluginResponse,
      marketplaces: [{
        ...pluginResponse.marketplaces[0],
        plugins: [installedPlugin],
      }],
    });
    vi.mocked(window.whale.marketplaces.sources).mockResolvedValue(disabledPolicy);
    vi.mocked(window.whale.mcp.list).mockResolvedValue({ data: [], nextCursor: null });

    render(<PluginMarketplaceDialog />);

    const tabs = within(screen.getByRole('navigation', { name: '插件商城分类' }));
    fireEvent.click(tabs.getByRole('button', { name: /^MCP/ }));

    const detailButton = await screen.findByRole('button', { name: '查看 fixture-mcp 详情' });
    const card = detailButton.closest('.plugin-card') as HTMLElement;
    expect(within(card).getByText('未启用')).toBeInTheDocument();
    expect(within(card).getByText('插件已下载；启用插件后加载此 MCP')).toBeInTheDocument();
    expect(within(card).getByText('工具将在载入后发现')).toBeInTheDocument();
    const mcpSwitch = within(card).getByRole('switch', { name: 'fixture-mcp 已停用' });
    expect(mcpSwitch).toHaveAttribute('aria-checked', 'false');
    expect(mcpSwitch).toBeDisabled();

    fireEvent.click(detailButton);
    await waitFor(() => expect(screen.getByText(/Bearer plaintext-fixture-token/)).toBeInTheDocument());
    expect(window.whale.plugins.contributions).toHaveBeenCalledWith({
      pluginId: 'fixture-plugin',
      marketplaceName: 'fixture-marketplace',
      marketplacePath: '/fixture/marketplace.json',
      pluginName: 'fixture-tools',
    });
  });
});
