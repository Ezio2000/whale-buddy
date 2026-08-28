import { chmodSync } from 'node:fs';

export const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

export function hardenPrivateDirectory(
  targetPath: string,
  platform: NodeJS.Platform = process.platform,
): void {
  hardenPrivatePath(targetPath, PRIVATE_DIRECTORY_MODE, platform);
}

export function hardenPrivateFile(
  targetPath: string,
  platform: NodeJS.Platform = process.platform,
): void {
  hardenPrivatePath(targetPath, PRIVATE_FILE_MODE, platform);
}

function hardenPrivatePath(targetPath: string, mode: number, platform: NodeJS.Platform): void {
  // Windows userData inherits the current user's ACL. chmod only maps a small
  // subset of POSIX bits there and must not be treated as an ACL implementation.
  if (platform === 'win32') return;
  chmodSync(targetPath, mode);
}
