import type { DesktopPlatform, DesktopPlatformStrategy } from './contract';
import { macosPlatformStrategy } from './macos';
import { windowsPlatformStrategy } from './windows';

export type { DesktopPlatform, DesktopPlatformStrategy } from './contract';

const strategies: Record<DesktopPlatform, DesktopPlatformStrategy> = {
  darwin: macosPlatformStrategy,
  win32: windowsPlatformStrategy,
};

export function requireDesktopPlatform(
  platform: NodeJS.Platform = process.platform,
): DesktopPlatform {
  if (platform === 'darwin' || platform === 'win32') return platform;
  throw new Error(`AI小鲸目前只支持 macOS 和 Windows，当前平台为 ${platform}`);
}

export function platformStrategyFor(platform: DesktopPlatform): DesktopPlatformStrategy {
  return strategies[platform];
}

export function currentPlatformStrategy(
  platform: NodeJS.Platform = process.platform,
): DesktopPlatformStrategy {
  return platformStrategyFor(requireDesktopPlatform(platform));
}

export function forgeTargetPlatform(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
  currentPlatform: NodeJS.Platform = process.platform,
): DesktopPlatform {
  const configured = environment.WHALE_TARGET_PLATFORM;
  if (configured) return requireDesktopPlatform(configured as NodeJS.Platform);
  const inline = argv
    .find((argument) => argument.startsWith('--platform='))
    ?.slice('--platform='.length);
  const flagIndex = argv.indexOf('--platform');
  const following = flagIndex >= 0 ? argv[flagIndex + 1] : undefined;
  return requireDesktopPlatform((inline ?? following ?? currentPlatform) as NodeJS.Platform);
}
