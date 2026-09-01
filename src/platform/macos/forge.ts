import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerZIP } from '@electron-forge/maker-zip';
import type { ForgePlatformStrategy } from '../forge-contract';

export const macosForgeStrategy: ForgePlatformStrategy = {
  packagerConfig: {
    appCategoryType: 'public.app-category.developer-tools',
    osxSign: {
      identity: '-',
      identityValidation: false,
      optionsForFile: () => ({ timestamp: 'none' }),
    },
  },
  makers: [new MakerDMG({}, ['darwin']), new MakerZIP({}, ['darwin'])],
};
