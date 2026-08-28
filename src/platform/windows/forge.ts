import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import type { ForgePlatformStrategy } from '../forge-contract';

export const windowsForgeStrategy: ForgePlatformStrategy = {
  packagerConfig: {},
  makers: [
    new MakerSquirrel({
      name: 'ai_xiaojing',
      authors: 'AI小鲸',
      description: 'AI小鲸 Codex 桌面客户端',
    }),
  ],
};
