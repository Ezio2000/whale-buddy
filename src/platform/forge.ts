import type { DesktopPlatform } from './contract';
import type { ForgePlatformStrategy } from './forge-contract';
import { macosForgeStrategy } from './macos/forge';
import { windowsForgeStrategy } from './windows/forge';

const strategies: Record<DesktopPlatform, ForgePlatformStrategy> = {
  darwin: macosForgeStrategy,
  win32: windowsForgeStrategy,
};

export function forgePlatformStrategy(platform: DesktopPlatform): ForgePlatformStrategy {
  return strategies[platform];
}
