import path from 'node:path';
import type { BrowserWindowConstructorOptions } from 'electron';

export type DesktopPlatform = 'darwin' | 'win32';

export function requireDesktopPlatform(platform: NodeJS.Platform = process.platform): DesktopPlatform {
  if (platform === 'darwin' || platform === 'win32') return platform;
  throw new Error(`AI小鲸目前只支持 macOS 和 Windows，当前平台为 ${platform}`);
}

export function forgeTargetPlatform(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
  currentPlatform: NodeJS.Platform = process.platform,
): DesktopPlatform {
  const configured = environment.WHALE_TARGET_PLATFORM;
  if (configured) return requireDesktopPlatform(configured as NodeJS.Platform);
  const inline = argv.find((argument) => argument.startsWith('--platform='))?.slice('--platform='.length);
  const flagIndex = argv.indexOf('--platform');
  const following = flagIndex >= 0 ? argv[flagIndex + 1] : undefined;
  return requireDesktopPlatform((inline ?? following ?? currentPlatform) as NodeJS.Platform);
}

export function executableFilename(
  baseName: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === 'win32' ? `${baseName}.exe` : baseName;
}

export function codexFilename(platform: NodeJS.Platform = process.platform): string {
  return executableFilename('codex', platform);
}

export function codeModeHostFilename(platform: NodeJS.Platform = process.platform): string {
  return executableFilename('codex-code-mode-host', platform);
}

export function developmentCodexPaths(
  projectRoot: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const filename = codexFilename(platform);
  return [
    path.join(projectRoot, 'codex-source', 'codex-rs', 'target', 'release', filename),
    path.join(projectRoot, 'codex-source', 'codex-rs', 'target', 'debug', filename),
  ];
}

export function packagedCodexPath(
  resourcesPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return path.join(resourcesPath, codexFilename(platform));
}

export function windowChromeOptions(
  platform: NodeJS.Platform = process.platform,
): Pick<
  BrowserWindowConstructorOptions,
  'titleBarStyle' | 'trafficLightPosition' | 'titleBarOverlay'
> {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 18, y: 18 },
    };
  }
  // Windows uses its native frame. Electron drag regions suppress pointer
  // events, and titleBarOverlay can cover controls below the caption buttons.
  return {};
}

export function packagedAppExecutable(
  outRoot: string,
  productName: string,
  platform: NodeJS.Platform = process.platform,
  architecture: string = process.arch,
): string {
  const packageRoot = path.join(outRoot, `${productName}-${platform}-${architecture}`);
  if (platform === 'darwin') {
    return path.join(packageRoot, `${productName}.app`, 'Contents', 'MacOS', productName);
  }
  return path.join(packageRoot, executableFilename(productName, platform));
}
