import type { DesktopPlatform } from './contract';
import { macosSandboxStrategy } from './macos/sandbox';
import type { SandboxPlatformStrategy } from './sandbox-contract';
import { windowsSandboxStrategy } from './windows/sandbox';

const strategies: Record<DesktopPlatform, SandboxPlatformStrategy> = {
  darwin: macosSandboxStrategy,
  win32: windowsSandboxStrategy,
};

export function sandboxPlatformStrategyFor(
  platform: DesktopPlatform,
): SandboxPlatformStrategy {
  return strategies[platform];
}

export function currentSandboxPlatformStrategy(): SandboxPlatformStrategy {
  const platform: DesktopPlatform = process.platform === 'win32' ? 'win32' : 'darwin';
  return sandboxPlatformStrategyFor(platform);
}
