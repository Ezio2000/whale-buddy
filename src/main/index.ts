import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, shell } from 'electron';
import squirrelStartup from 'electron-squirrel-startup';
import packageJson from '../../package.json';
import protocolManifest from '../generated/protocol/manifest.json';
import { currentPlatformStrategy } from '../platform';
import { AppServerClient } from './app-server-client';
import { DiagnosticLog } from './diagnostic-log';
import { registerIpc } from './ipc';
import { installApplicationMenu } from './menu';
import { ExtensionPolicyStore } from './extension-policy';
import { ProjectStore } from './projects';
import { prepareDataDirectories, sanitizeStandaloneMcpConfig } from './data-directories';
import { RuntimeSettingsStore } from './runtime-settings';
import { TurnPlanStore } from './turn-plans';
import { TurnChangesStore } from './turn-changes';
import { ScheduledTaskStore } from './scheduled-tasks';
import { resolveSidecarPath } from './sidecar-path';
import { registerPluginProtocol, registerPluginSchemes } from './plugin-host';
import { PluginCredentialStore } from './plugin-credential-store';
import { WhaleAuthManager } from './auth';
import { OperationStore } from './operations';
import { ArtifactStore } from './artifacts';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = app.isPackaged ? process.resourcesPath : app.getAppPath();
const platform = currentPlatformStrategy();

let mainWindow: BrowserWindow | null = null;
let appServer: AppServerClient | null = null;
let authManager: WhaleAuthManager | null = null;
let unregisterIpc: (() => void) | null = null;
let shutdownStarted = false;

if (squirrelStartup) app.quit();

registerPluginSchemes();

async function createWindow(): Promise<void> {
  const data = prepareDataDirectories(app.getPath('userData'));
  authManager ??= new WhaleAuthManager({
    stateRoot: data.uiStateRoot,
    openExternal: (url) => shell.openExternal(url),
  });
  const diagnosticLog = new DiagnosticLog(path.join(data.logsRoot, 'app-server.log'));
  const projects = new ProjectStore(data.uiStateRoot);
  const extensionPolicy = new ExtensionPolicyStore(data.uiStateRoot);
  const pluginCredentials = new PluginCredentialStore(data.uiStateRoot);
  const runtimeSettings = new RuntimeSettingsStore(data.uiStateRoot);
  const turnPlans = new TurnPlanStore(data.uiStateRoot);
  const turnChanges = new TurnChangesStore(data.uiStateRoot);
  const operations = new OperationStore(data.uiStateRoot);
  const artifacts = new ArtifactStore(data.artifactsRoot);
  const scheduledTasks = new ScheduledTaskStore(data.uiStateRoot);
  const branding = runtimeSettings.readBranding();
  const pluginCredentialEnvironment = () => {
    const resolved = pluginCredentials.resolveLaunchEnvironment(
      extensionPolicy.activeCredentials(),
    );
    for (const error of resolved.errors) {
      diagnosticLog.write('runtime', `插件凭据未注入：${error}`);
    }
    return resolved.environment;
  };

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    title: branding.name,
    backgroundColor: '#f3f2ef',
    ...platform.windowChromeOptions(),
    webPreferences: {
      preload: path.join(moduleDirectory, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level < 2) return;
    diagnosticLog.write('protocol', `renderer: ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description, validatedUrl) => {
    diagnosticLog.write('protocol', `renderer load failed ${code}: ${description} (${validatedUrl})`);
  });
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    diagnosticLog.write('protocol', `preload failed ${preloadPath}: ${error.message}`);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    diagnosticLog.write('protocol', `renderer process gone: ${details.reason} (${details.exitCode})`);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL();
    if (url === current) return;
    event.preventDefault();
    if (isHttpUrl(url)) void shell.openExternal(url);
  });

  installApplicationMenu(mainWindow, branding.name);

  try {
    const sidecar = resolveSidecarPath(projectRoot);
    appServer = new AppServerClient({
      binaryPath: sidecar.path,
      binaryArguments: sidecar.arguments,
      binaryEnvironment: sidecar.environment,
      sidecarHome: data.sidecarHome,
      codexHome: data.codexHome,
      diagnosticLog,
      clientVersion: packageJson.version,
      clientTitle: () => runtimeSettings.readBranding().name,
      protocolVersion: protocolManifest.codexCommit,
      expectedCodexVersion: sidecar.version,
      launchConfiguration: () => {
        // Reassert the plugin-only extension boundary before every initial
        // launch and automatic/manual restart, not just when the window opens.
        sanitizeStandaloneMcpConfig(data.codexHome);
        const runtime = runtimeSettings.launchConfiguration();
        return {
          environment: {
            ...runtime.environment,
            ...pluginCredentialEnvironment(),
          },
          configOverrides: [
            ...runtime.configOverrides,
            ...extensionPolicy.launchConfigOverrides(),
          ],
        };
      },
    });
    unregisterIpc = registerIpc({
      auth: authManager,
      appServer,
      projects,
      extensionPolicy,
      runtimeSettings,
      pluginCredentials,
      turnPlans,
      turnChanges,
      operations,
      artifacts,
      scheduledTasks,
      attachmentsRoot: data.attachmentsRoot,
      window: mainWindow,
      updateBranding: (nextBranding) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.setTitle(nextBranding.name);
        installApplicationMenu(mainWindow, nextBranding.name);
      },
      quit: () => app.quit(),
    });
    void appServer.start()
      .then(() => ensureOfficeMarketplace(appServer!, extensionPolicy, projectRoot))
      .catch((error) => {
        diagnosticLog.write('runtime', error instanceof Error ? error.message : String(error));
      });
  } catch (error) {
    diagnosticLog.write('runtime', error instanceof Error ? error.message : String(error));
    // A missing or mismatched sidecar should still produce a usable diagnostics window.
    appServer = new AppServerClient({
      binaryPath: path.join(projectRoot, platform.executableFilename('.missing-codex-sidecar')),
      sidecarHome: data.sidecarHome,
      codexHome: data.codexHome,
      diagnosticLog,
      clientVersion: packageJson.version,
      clientTitle: () => runtimeSettings.readBranding().name,
      protocolVersion: protocolManifest.codexCommit,
      expectedCodexVersion: null,
      launchConfiguration: () => {
        const runtime = runtimeSettings.launchConfiguration();
        return {
          environment: {
            ...runtime.environment,
            ...pluginCredentialEnvironment(),
          },
          configOverrides: [
            ...runtime.configOverrides,
            ...extensionPolicy.launchConfigOverrides(),
          ],
        };
      },
    });
    unregisterIpc = registerIpc({
      auth: authManager,
      appServer,
      projects,
      extensionPolicy,
      runtimeSettings,
      pluginCredentials,
      turnPlans,
      turnChanges,
      operations,
      artifacts,
      scheduledTasks,
      attachmentsRoot: data.attachmentsRoot,
      window: mainWindow,
      updateBranding: (nextBranding) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.setTitle(nextBranding.name);
        installApplicationMenu(mainWindow, nextBranding.name);
      },
      quit: () => app.quit(),
    });
    void appServer.start().catch(() => undefined);
  }

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(moduleDirectory, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
}

async function ensureOfficeMarketplace(
  client: AppServerClient,
  policy: ExtensionPolicyStore,
  root: string,
): Promise<void> {
  if (policy.source('whale-office')) return;
  const source = app.isPackaged
    ? path.join(process.resourcesPath, 'office')
    : path.join(root, 'marketplaces', 'office');
  const response = await client.request('marketplace/add', {
    source, refName: null, sparsePaths: null,
  }) as { marketplaceName?: unknown };
  if (response.marketplaceName !== 'whale-office') throw new Error('办公商城清单名称无效');
  policy.addMarketplace('whale-office', source, null, true);
  await client.restart();
}

app.whenReady().then(async () => {
  if (platform.appUserModelId) app.setAppUserModelId(platform.appUserModelId);
  registerPluginProtocol();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (platform.quitWhenAllWindowsClosed) app.quit();
});

app.on('before-quit', (event) => {
  if (shutdownStarted) return;
  event.preventDefault();
  shutdownStarted = true;
  unregisterIpc?.();
  unregisterIpc = null;
  void Promise.all([
    appServer?.stop() ?? Promise.resolve(),
    authManager?.dispose() ?? Promise.resolve(),
  ]).finally(() => {
    appServer = null;
    authManager = null;
    app.quit();
  });
});

function isHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
