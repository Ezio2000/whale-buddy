export type DesktopPlatform = 'darwin' | 'win32';

export interface WindowInteractionStrategy {
  nativeTitleBar: boolean;
  rendererDragRegions: boolean;
}

const strategies: Record<DesktopPlatform, WindowInteractionStrategy> = {
  darwin: {
    nativeTitleBar: false,
    rendererDragRegions: true,
  },
  win32: {
    nativeTitleBar: true,
    rendererDragRegions: false,
  },
};

export function windowInteractionStrategy(
  platform: DesktopPlatform,
): WindowInteractionStrategy {
  return strategies[platform];
}
