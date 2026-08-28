import type { SandboxPlatformStrategy } from '../sandbox-contract';

export const macosSandboxStrategy: SandboxPlatformStrategy = {
  id: 'darwin',
  rendererDragRegions: true,
  isAbsolutePath: (value) => value.startsWith('/'),
};
