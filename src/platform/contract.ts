import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  MenuItemConstructorOptions,
} from 'electron';
import type { MenuCommand } from '../shared/types';

export type DesktopPlatform = 'darwin' | 'win32';

export interface ApplicationMenuContext {
  window: BrowserWindow;
  brandName: string;
  send(command: MenuCommand): void;
  showAboutPanel(): void;
}

export interface DesktopPlatformStrategy {
  id: DesktopPlatform;
  codexFilename: string;
  codeModeHostFilename: string;
  appUserModelId: string | null;
  quitWhenAllWindowsClosed: boolean;
  enforcesPrivateMode: boolean;
  executableFilename(baseName: string): string;
  assertExecutable(targetPath: string): void;
  hardenPrivatePath(targetPath: string, mode: number): void;
  windowChromeOptions(): Pick<
    BrowserWindowConstructorOptions,
    'titleBarStyle' | 'trafficLightPosition' | 'titleBarOverlay'
  >;
  packagedAppExecutable(
    outRoot: string,
    productName: string,
    architecture: string,
  ): string;
  applicationMenuTemplate(context: ApplicationMenuContext): MenuItemConstructorOptions[];
}
