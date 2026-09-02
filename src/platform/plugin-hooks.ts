import type { DesktopPlatform } from './contract';
import { currentPlatformStrategy } from './index';

export function pluginHookPlatformCommand(
  command: string,
  commandWindows: string | null,
  platform: DesktopPlatform = currentPlatformStrategy().id,
): string {
  return platform === 'win32' && commandWindows ? commandWindows : command;
}
