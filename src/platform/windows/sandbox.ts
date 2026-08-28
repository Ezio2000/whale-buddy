import type { SandboxPlatformStrategy } from '../sandbox-contract';

export const windowsSandboxStrategy: SandboxPlatformStrategy = {
  id: 'win32',
  rendererDragRegions: false,
  isAbsolutePath: (value) => /^(?:[A-Za-z]:[\\/]|[\\/])/.test(value),
};
