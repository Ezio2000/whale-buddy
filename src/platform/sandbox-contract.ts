import type { DesktopPlatform } from './contract';

export interface SandboxPlatformStrategy {
  id: DesktopPlatform;
  rendererDragRegions: boolean;
  isAbsolutePath(value: string): boolean;
}
