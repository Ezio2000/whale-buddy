import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { PluginUiProvider } from './plugin-ui/PluginUiProvider';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

document.documentElement.dataset.desktopPlatform = window.whale.runtime.platform;

createRoot(root).render(
  <StrictMode>
    <PluginUiProvider>
      <App />
    </PluginUiProvider>
  </StrictMode>,
);
