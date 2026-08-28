import { currentPlatformStrategy, platformStrategyFor, type DesktopPlatform } from '../platform';

export const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

export function hardenPrivateDirectory(
  targetPath: string,
  platform: DesktopPlatform = currentPlatformStrategy().id,
): void {
  hardenPrivatePath(targetPath, PRIVATE_DIRECTORY_MODE, platform);
}

export function hardenPrivateFile(
  targetPath: string,
  platform: DesktopPlatform = currentPlatformStrategy().id,
): void {
  hardenPrivatePath(targetPath, PRIVATE_FILE_MODE, platform);
}

function hardenPrivatePath(targetPath: string, mode: number, platform: DesktopPlatform): void {
  platformStrategyFor(platform).hardenPrivatePath(targetPath, mode);
}
