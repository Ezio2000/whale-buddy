import path from 'node:path';
import type { DesktopPlatform } from './window-strategy';

export interface PathValidationStrategy {
  isAbsolute(value: string): boolean;
}

const strategies: Record<DesktopPlatform, PathValidationStrategy> = {
  darwin: {
    isAbsolute: path.posix.isAbsolute,
  },
  win32: {
    isAbsolute: path.win32.isAbsolute,
  },
};

export function pathValidationStrategy(platform: DesktopPlatform): PathValidationStrategy {
  return strategies[platform];
}
