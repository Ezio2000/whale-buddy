import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, shell } from 'electron';
import squirrelStartup from 'electron-squirrel-startup';
import packageJson from '../../package.json';
import protocolManifest from '../generated/protocol/manifest.json';
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
import { registerPluginUiProtocol, registerPluginUiSchemes } from './plugin-ui';
import { executableFilename, windowChromeOptions } from './platform';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = app.isPackaged ? process.resourcesPath : app.getAppPath();

let mainWindow: BrowserWindow | null = null;
let appServer: AppServerClient | null = null;
let unregisterIpc: (() => void) | null = null;
let shutdownStarted = false;

if (squirrelStartup) app.quit();

registerPluginUiSchemes();

async function createWindow(): Promise<void> {
  const data = prepareDataDirectories(app.getPath('userData'));
  const diagnosticLog = new DiagnosticLog(path.join(data.logsRoot, 'app-server.log'));
  const projects = new ProjectStore(data.uiStateRoot);
  const extensionPolicy = new ExtensionPolicyStore(data.uiStateRoot);
  const runtimeSettings = new RuntimeSettingsStore(data.uiStateRoot);
  const turnPlans = new TurnPlanStore(data.uiStateRoot);
  const turnChanges = new TurnChangesStore(data.uiStateRoot);
  const scheduledTasks = new ScheduledTaskStore(data.uiStateRoot);
  const branding = runtimeSettings.readBranding();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    title: branding.name,
    backgroundColor: '#f3f2ef',
    ...windowChromeOptions(),
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
          environment: runtime.environment,
          configOverrides: [
            ...runtime.configOverrides,
            ...extensionPolicy.launchConfigOverrides(),
          ],
        };
      },
    });
    unregisterIpc = registerIpc({
      appServer,
      projects,
      extensionPolicy,
      runtimeSettings,
      turnPlans,
      turnChanges,
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
    void appServer.start().catch((error) => {
      diagnosticLog.write('runtime', error instanceof Error ? error.message : String(error));
    });
  } catch (error) {
    diagnosticLog.write('runtime', error instanceof Error ? error.message : String(error));
    // A missing or mismatched sidecar should still produce a usable diagnostics window.
    appServer = new AppServerClient({
      binaryPath: path.join(projectRoot, executableFilename('.missing-codex-sidecar')),
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
          environment: runtime.environment,
          configOverrides: [
            ...runtime.configOverrides,
            ...extensionPolicy.launchConfigOverrides(),
          ],
        };
      },
    });
    unregisterIpc = registerIpc({
      appServer,
      projects,
      extensionPolicy,
      runtimeSettings,
      turnPlans,
      turnChanges,
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

app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('dev.whalebuddy.desktop');
  registerPluginUiProtocol();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (shutdownStarted) return;
  event.preventDefault();
  shutdownStarted = true;
  unregisterIpc?.();
  unregisterIpc = null;
  void (appServer?.stop() ?? Promise.resolve()).finally(() => {
    appServer = null;
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
