import process from 'node:process';
import { macosScriptPlatform } from './macos/index.mjs';
import { windowsScriptPlatform } from './windows/index.mjs';

const strategies = {
  darwin: macosScriptPlatform,
  win32: windowsScriptPlatform,
};

export function scriptPlatformFor(platform) {
  const strategy = strategies[platform];
  if (strategy) return strategy;
  throw new Error(`AI小鲸目前只支持 macOS 和 Windows，当前平台为 ${platform}`);
}

export const currentScriptPlatform = scriptPlatformFor(process.platform);
