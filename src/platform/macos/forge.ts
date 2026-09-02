import { MakerDMG } from '@electron-forge/maker-dmg';
import type { ForgePlatformStrategy } from '../forge-contract';

export const macosForgeStrategy: ForgePlatformStrategy = {
  packagerConfig: {
    appCategoryType: 'public.app-category.developer-tools',
    osxSign: {
      identity: '-',
      identityValidation: false,
      optionsForFile: () => ({
        hardenedRuntime: false,
        timestamp: 'none',
      }),
    },
  },
  makers: [new MakerDMG({}, ['darwin'])],
};
