import type { ForgeConfig } from '@electron-forge/shared-types';

export interface ForgePlatformStrategy {
  packagerConfig: NonNullable<ForgeConfig['packagerConfig']>;
  makers: NonNullable<ForgeConfig['makers']>;
}
