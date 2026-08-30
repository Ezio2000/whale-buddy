import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { currentPlatformStrategy } from '../../src/platform';

test('packaged renderer has a narrow IPC surface and recovers its sidecar', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'whale-e2e-'));
  const appExecutable = findPackagedAppExecutable();
  const application = await electron.launch({
    executablePath: appExecutable,
    args: [`--user-data-dir=${userData}`],
    env: {
      ...process.env,
      WHALE_E2E_CODEX_SCRIPT: path.resolve('tests/fixtures/codex'),
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
  });

  try {
    const page = await application.firstWindow();
    await expect(page).toHaveTitle('AI小鲸');
    await page.waitForFunction(async () => (await window.whale.runtime.status()).phase === 'ready');
    await configureFixtureProvider(page);
    await page.waitForFunction(async () => (await window.whale.runtime.status()).phase === 'ready');
    await expect(page.getByText('打开第一个项目')).toBeVisible();

    const boundary = await page.evaluate(() => ({
      requireType: typeof (globalThis as { require?: unknown }).require,
      processType: typeof (globalThis as { process?: unknown }).process,
      apiKeys: Object.keys(window.whale).sort(),
      runtimeKeys: Object.keys(window.whale.runtime).sort(),
      marketplaceKeys: Object.keys(window.whale.marketplaces).sort(),
    }));
    expect(boundary.requireType).toBe('undefined');
    expect(boundary.processType).toBe('undefined');
    expect(boundary.apiKeys).toEqual([
      'approvals',
      'config',
      'events',
      'files',
      'marketplaces',
      'mcp',
      'models',
      'plugins',
      'projects',
      'runtime',
      'schedules',
      'skills',
      'threads',
      'turns',
    ]);
    expect(boundary.runtimeKeys).toEqual([
      'branding',
      'configure',
      'configureBranding',
      'pickBrandIcon',
      'quit',
      'restart',
      'revealProviderApiKey',
      'settings',
      'status',
      'windowCapabilities',
    ]);
    expect(boundary.marketplaceKeys).toEqual([
      'add',
      'remove',
      'setEnabled',
      'sources',
      'upgrade',
    ]);

    await page.getByRole('button', { name: '插件商城' }).click();
    await expect(page.getByRole('heading', { name: '插件商城' })).toBeVisible();
    const refreshButton = page.getByRole('button', { name: '全部刷新' });
    await expect(refreshButton).toHaveCount(1);
    const marketplaceTabs = page.getByRole('navigation', { name: '插件商城分类' });
    await expect(page.getByText('Fixture Tools', { exact: true })).toHaveCount(0);
    await marketplaceTabs.getByRole('button', { name: /商城源/ }).click();
    await expect(page.getByText('还没有商城源')).toBeVisible();
    await expect(page.getByText('Codex 内置 Skills')).toHaveCount(0);
    await expect(page.getByText('ChatGPT Apps')).toHaveCount(0);
    await expect(page.getByText('OpenAI 官方远程商城')).toHaveCount(0);
    await page.getByRole('textbox', { name: '商城源', exact: true }).fill('https://example.test/fixture-marketplace.git');
    await page.getByRole('button', { name: '添加' }).click();
    await expect(page.getByText(/商城源“fixture-marketplace”已添加/)).toBeVisible();

    await marketplaceTabs.getByRole('button', { name: /^插件/ }).click();
    await expect(page.getByText('Fixture Tools', { exact: true }).first()).toBeVisible();
    await expect(page.locator('.plugin-glyph svg').first()).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '下载插件' }).click();
    await expect(page.getByText(/已下载并保持停用/)).toBeVisible();
    await expect(page.getByRole('button', { name: '启用插件' })).toBeVisible();

    await marketplaceTabs.getByRole('button', { name: /Skills/ }).click();
    await expect(page.getByText('Fixture Core Skill')).toHaveCount(0);
    await expect(page.getByText('Fixture Plugin Skill')).toHaveCount(0);

    await marketplaceTabs.getByRole('button', { name: /^插件/ }).click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '启用插件' }).click();
    await expect(page.getByText(/全部 Skills 与 MCP 已恢复为默认开启/)).toBeVisible();

    await marketplaceTabs.getByRole('button', { name: /Skills/ }).click();
    await page.getByRole('switch', { name: 'Fixture Plugin Skill 已启用' }).click();
    await expect(page.getByRole('switch', { name: 'Fixture Plugin Skill 已停用' })).toBeVisible();
    await marketplaceTabs.getByRole('button', { name: /^MCP/ }).click();
    await page.getByRole('switch', { name: 'fixture-mcp 已启用' }).click();
    await expect(page.getByRole('switch', { name: 'fixture-mcp 已停用' })).toBeVisible();

    await marketplaceTabs.getByRole('button', { name: /^插件/ }).click();
    await page.getByRole('button', { name: '停用插件' }).click();
    await expect(page.getByText(/已停用/)).toBeVisible();
    await expect(page.getByRole('button', { name: '启用插件' })).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '启用插件' }).click();
    await expect(page.getByRole('button', { name: '停用插件' })).toBeVisible();

    await marketplaceTabs.getByRole('button', { name: /Skills/ }).click();
    await expect(page.getByText('Fixture Plugin Skill')).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Fixture Plugin Skill 已启用' })).toBeVisible();

    await marketplaceTabs.getByRole('button', { name: /^MCP/ }).click();
    await expect(page.getByText('fixture-mcp', { exact: true })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'fixture-mcp 已启用' })).toBeVisible();
    await page.getByRole('button', { name: '查看 fixture-mcp 详情' }).click();
    await expect(page.getByText('inspect_fixture', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '连接' })).toBeVisible();
    await expect(marketplaceTabs.getByRole('button', { name: /^工具/ })).toHaveCount(0);
    await expect(page.getByText('view_image', { exact: true })).toHaveCount(0);
    await expect(page.getByText('web_search', { exact: true })).toHaveCount(0);
    const refreshButtonBox = await refreshButton.boundingBox();
    if (!refreshButtonBox) throw new Error('全部刷新按钮不可见');
    const refreshButtonRight = Math.round(refreshButtonBox.x + refreshButtonBox.width);

    await marketplaceTabs.getByRole('button', { name: /商城源/ }).click();
    await expect
      .poll(async () => {
        const box = await refreshButton.boundingBox();
        return box ? Math.round(box.x + box.width) : null;
      })
      .toBe(refreshButtonRight);
    await refreshButton.click();
    await expect(page.getByText(/全部刷新完成/)).toBeVisible();
    await expect(page.getByText(/全部刷新完成/)).toHaveCount(0, { timeout: 5_000 });

    const fixtureVisibility = page.getByRole('checkbox', { name: 'fixture-marketplace 运行时授权' });
    await expect(fixtureVisibility).toBeChecked();
    await fixtureVisibility.click();
    await expect(fixtureVisibility).not.toBeChecked();
    await refreshButton.click();
    await expect(page.getByText(/没有已勾选的 Git 商城源需要拉取/)).toBeVisible();
    await marketplaceTabs.getByRole('button', { name: /^插件/ }).click();
    await expect(page.getByText('Fixture Tools', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: '关闭插件商城' }).click();
    await page.getByRole('button', { name: '插件商城' }).click();
    await marketplaceTabs.getByRole('button', { name: /商城源/ }).click();
    await expect(fixtureVisibility).not.toBeChecked();
    await fixtureVisibility.click();
    await expect(fixtureVisibility).toBeChecked();
    await page.getByRole('button', { name: '关闭插件商城' }).click();

    const connectionSettings = await page.evaluate(() => window.whale.runtime.settings());
    expect(connectionSettings).toMatchObject({
      proxy: { mode: 'inherit' },
      provider: { mode: 'custom', hasApiKey: true },
    });

    const restoredThreadIds = await page.evaluate(async () => {
      const response = (await window.whale.threads.list({ archived: false })) as {
        data?: Array<{ id?: string }>;
      };
      return response.data?.map((thread) => thread.id) ?? [];
    });
    expect(restoredThreadIds).toContain('01900000-0000-7000-8000-000000000001');
    expect(restoredThreadIds).toContain('01900000-0000-7000-8000-000000000002');

    const validationError = await page.evaluate(async () => {
      try {
        await window.whale.files.search('relative/path', 'secret');
        return null;
      } catch (error) {
        return String(error);
      }
    });
    expect(validationError).toContain('绝对路径');

    const dummyProviderKey = 'whale-e2e-provider-key-not-a-secret';
    const customSettings = await page.evaluate(
      (apiKey) =>
        window.whale.runtime.configure({
          proxy: { mode: 'off', url: '', noProxy: '' },
          provider: {
            mode: 'custom',
            id: 'fixture_responses',
            name: 'Fixture Responses',
            baseUrl: 'https://fixture.example/v1',
            model: 'fixture-model',
            capabilities: {
              contextWindow: 128_000,
              imageInput: false,
              supportsReasoning: true,
              reasoningEfforts: ['low', 'medium', 'high'],
              defaultReasoningEffort: 'medium',
              supportsReasoningSummaries: true,
            },
            apiKey,
          },
        }),
      dummyProviderKey,
    );
    expect(customSettings.provider).toMatchObject({ mode: 'custom', hasApiKey: true });
    expect(JSON.stringify(customSettings)).not.toContain(dummyProviderKey);
    expect(await page.evaluate(() => window.whale.runtime.revealProviderApiKey())).toBe(
      dummyProviderKey,
    );
    expect(JSON.stringify(await page.evaluate(() => Object.values(localStorage)))).not.toContain(
      dummyProviderKey,
    );

    await page.reload();
    await page.waitForFunction(async () => (await window.whale.runtime.status()).phase === 'ready');
    await page.setViewportSize({ width: 960, height: 620 });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByLabel('自定义 Provider API Key')).toBeVisible();
    await expect(page.getByText(/cc-switch/i)).toHaveCount(0);

    const settingsGroups = page.locator('.settings-groups');
    const initialDialogLayout = await page.evaluate(() => {
      const dialog = document.querySelector<HTMLElement>('.settings-dialog');
      const scroller = document.querySelector<HTMLElement>('.settings-groups');
      const sidebar = document.querySelector<HTMLElement>('.sidebar');
      if (!dialog || !scroller || !sidebar) throw new Error('Settings layout is missing');
      const dialogRect = dialog.getBoundingClientRect();
      const sidebarRect = sidebar.getBoundingClientRect();
      return {
        dialogTop: dialogRect.top,
        dialogBottom: dialogRect.bottom,
        viewportHeight: window.innerHeight,
        scrollerClientHeight: scroller.clientHeight,
        scrollerScrollHeight: scroller.scrollHeight,
        sidebarTop: sidebarRect.top,
        sidebarScrollTop: sidebar.scrollTop,
      };
    });
    expect(initialDialogLayout.dialogTop).toBeGreaterThanOrEqual(0);
    expect(initialDialogLayout.dialogBottom).toBeLessThanOrEqual(
      initialDialogLayout.viewportHeight,
    );
    expect(initialDialogLayout.scrollerScrollHeight).toBeGreaterThan(
      initialDialogLayout.scrollerClientHeight,
    );

    await settingsGroups.hover();
    await page.mouse.wheel(0, 10_000);
    await expect.poll(() => settingsGroups.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(page.getByText('外观', { exact: true })).toBeVisible();

    const finalBackgroundLayout = await page.evaluate(() => {
      const sidebar = document.querySelector<HTMLElement>('.sidebar');
      if (!sidebar) throw new Error('Sidebar is missing');
      return {
        sidebarTop: sidebar.getBoundingClientRect().top,
        sidebarScrollTop: sidebar.scrollTop,
        documentScrollTop: document.documentElement.scrollTop,
      };
    });
    expect(finalBackgroundLayout.sidebarTop).toBe(initialDialogLayout.sidebarTop);
    expect(finalBackgroundLayout.sidebarScrollTop).toBe(initialDialogLayout.sidebarScrollTop);
    expect(finalBackgroundLayout.documentScrollTop).toBe(0);
    await page.getByRole('button', { name: '关闭' }).click();

    const runtimeSettingsFile = await readFile(
      path.join(userData, 'ui-state', 'runtime-settings.json'),
      'utf8',
    );
    expect(runtimeSettingsFile).toContain(dummyProviderKey);
    expect(JSON.parse(runtimeSettingsFile)).toMatchObject({ apiKey: dummyProviderKey });

    const status = await page.evaluate(() => window.whale.runtime.status());
    expect(status.sidecarHome).toBe(path.join(await realpath(userData), 'sidecar-home'));
    expect(status.sidecarHome).not.toBe(process.env.HOME);
    expect(status.codexHome).toContain('codex-home');
    expect(status.codexHome).not.toMatch(/\/\.codex(?:\/|$)/);

    process.kill(status.pid!, 'SIGTERM');
    await page.waitForFunction(
      async (generation) => {
        const current = await window.whale.runtime.status();
        return current.phase === 'ready' && current.generation > generation;
      },
      status.generation,
    );
  } finally {
    await application.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test('fresh startup offers only Provider API Key onboarding', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'whale-login-e2e-'));
  const appExecutable = findPackagedAppExecutable();
  const application = await electron.launch({
    executablePath: appExecutable,
    args: [`--user-data-dir=${userData}`],
    env: {
      ...process.env,
      WHALE_E2E_CODEX_SCRIPT: path.resolve('tests/fixtures/codex'),
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
  });

  try {
    const page = await application.firstWindow();
    await expect(page.getByRole('heading', { name: '欢迎使用 AI小鲸' })).toBeVisible();
    await expect(page.getByText(/ChatGPT 登录/)).toHaveCount(0);
    expect(await page.evaluate(() => 'account' in window.whale)).toBe(false);
    await page.getByRole('button', { name: /配置 Provider 与 API Key/ }).click();
    const proxySelect = page.getByRole('combobox').first();
    await proxySelect.selectOption('off');
    await expect(proxySelect).toHaveText(/不使用代理/);
    await page.getByLabel('Provider ID').fill('fixture_responses');
    await page.getByLabel('Provider 名称').fill('Fixture Responses');
    await page.getByLabel('Responses Base URL').fill('https://fixture.example/v1');
    await page.getByLabel('自定义模型名称').fill('fixture-model');
    const keyInput = page.getByLabel('自定义 Provider API Key');
    await expect(keyInput).toHaveAttribute('type', 'password');
    await keyInput.fill('fixture-provider-key-not-a-secret');
    await page.getByRole('button', { name: '保存并重连' }).click();
    await expect(page.getByText('设置已生效，sidecar 已重启。')).toBeVisible();
    await page.getByRole('button', { name: '关闭' }).click();
    await expect(page.getByText('打开第一个项目')).toBeVisible();
    const savedValues = await page.evaluate(() => Object.values(localStorage));
    expect(JSON.stringify(savedValues)).not.toContain('fixture-provider-key-not-a-secret');
    expect(await page.evaluate(() => window.whale.runtime.settings())).toMatchObject({
      provider: { mode: 'custom', hasApiKey: true },
    });
  } finally {
    await application.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test('long conversations stay inside the workspace while settings scroll independently', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'whale-layout-e2e-'));
  const appExecutable = findPackagedAppExecutable();
  const projectPath = path.resolve('.');
  const uiState = path.join(userData, 'ui-state');
  await mkdir(uiState, { recursive: true });
  await writeFile(
    path.join(uiState, 'projects.json'),
    `${JSON.stringify(
      {
        version: 1,
        projects: [
          {
            id: 'fixture-project',
            path: projectPath,
            name: 'whale-buddy',
            lastOpenedAt: Date.now(),
          },
        ],
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  const application = await electron.launch({
    executablePath: appExecutable,
    args: [`--user-data-dir=${userData}`],
    env: {
      ...process.env,
      WHALE_E2E_CODEX_SCRIPT: path.resolve('tests/fixtures/codex'),
      WHALE_FIXTURE_LONG_HISTORY: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
  });

  try {
    const page = await application.firstWindow();
    await page.setViewportSize({ width: 960, height: 620 });
    await page.waitForFunction(async () => (await window.whale.runtime.status()).phase === 'ready');
    await configureFixtureProvider(page);
    await page.waitForFunction(async () => (await window.whale.runtime.status()).phase === 'ready');
    await page.waitForFunction(() => {
      const conversation = document.querySelector<HTMLElement>('.conversation-scroll');
      return Boolean(conversation && conversation.scrollHeight > conversation.clientHeight);
    });

    const workspaceLayout = await readLayout(page);
    expect(workspaceLayout.rootScrollTop).toBe(0);
    expect(workspaceLayout.rootScrollHeight).toBe(workspaceLayout.rootClientHeight);
    expect(workspaceLayout.shellScrollHeight).toBe(workspaceLayout.shellClientHeight);
    expect(workspaceLayout.sidebarTop).toBe(0);
    expect(workspaceLayout.sidebarBottom).toBe(workspaceLayout.viewportHeight);
    expect(workspaceLayout.conversationScrollHeight).toBeGreaterThan(
      workspaceLayout.conversationClientHeight,
    );

    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.waitForTimeout(200);
    const beforeScroll = await readLayout(page);
    expect(beforeScroll.rootScrollTop).toBe(0);
    expect(beforeScroll.sidebarTop).toBe(0);

    const settingsGroups = page.locator('.settings-groups');
    await settingsGroups.hover();
    await page.mouse.wheel(0, 10_000);
    await expect.poll(() => settingsGroups.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    const afterScroll = await readLayout(page);
    expect(afterScroll.rootScrollTop).toBe(0);
    expect(afterScroll.sidebarTop).toBe(0);
    expect(afterScroll.dialogTop).toBe(beforeScroll.dialogTop);
    expect(afterScroll.headingTop).toBe(beforeScroll.headingTop);

    await page.getByRole('button', { name: '关闭' }).click();
    await page.locator('.thread-row', { hasText: '旧 Provider 会话' }).locator('.thread-main').click();
    await expect(page.getByText('查看旧 Provider 会话记录')).toBeVisible();
    await expect(page.getByText('来自旧 Provider 的持久化消息')).toBeVisible();
    await expect(page.getByText(/会话记录已加载，但当前无法继续该线程/)).toBeVisible();
  } finally {
    await application.close();
    await rm(userData, { recursive: true, force: true });
  }
});

async function readLayout(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('#root');
    const shell = document.querySelector<HTMLElement>('.app-shell');
    const sidebar = document.querySelector<HTMLElement>('.sidebar');
    const conversation = document.querySelector<HTMLElement>('.conversation-scroll');
    const dialog = document.querySelector<HTMLElement>('.settings-dialog');
    const heading = document.querySelector<HTMLElement>('.dialog-heading');
    if (!root || !shell || !sidebar || !conversation) throw new Error('Workspace layout is missing');
    const sidebarRect = sidebar.getBoundingClientRect();
    return {
      viewportHeight: window.innerHeight,
      rootScrollTop: root.scrollTop,
      rootScrollHeight: root.scrollHeight,
      rootClientHeight: root.clientHeight,
      shellScrollHeight: shell.scrollHeight,
      shellClientHeight: shell.clientHeight,
      sidebarTop: sidebarRect.top,
      sidebarBottom: sidebarRect.bottom,
      conversationScrollHeight: conversation.scrollHeight,
      conversationClientHeight: conversation.clientHeight,
      dialogTop: dialog?.getBoundingClientRect().top ?? null,
      headingTop: heading?.getBoundingClientRect().top ?? null,
    };
  });
}

async function configureFixtureProvider(page: Page): Promise<void> {
  await page.evaluate(() =>
    window.whale.runtime.configure({
      proxy: { mode: 'inherit', url: '', noProxy: 'localhost,127.0.0.1,::1' },
      provider: {
        mode: 'custom',
        id: 'fixture_responses',
        name: 'Fixture Responses',
        baseUrl: 'https://fixture.example/v1',
        model: 'fixture-model',
        capabilities: {
          contextWindow: 128_000,
          imageInput: false,
          supportsReasoning: true,
          reasoningEfforts: ['low', 'medium', 'high'],
          defaultReasoningEffort: 'medium',
          supportsReasoningSummaries: true,
        },
        apiKey: 'fixture-e2e-key-not-a-secret',
      },
    }),
  );
  await page.reload();
}

function findPackagedAppExecutable(): string {
  const outRoot = path.resolve(process.env.WHALE_FORGE_OUT_DIR ?? 'out');
  return currentPlatformStrategy().packagedAppExecutable(outRoot, 'Whale Buddy', process.arch);
}
