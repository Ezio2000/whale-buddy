import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { PluginHostProvider } from './plugin-ui/PluginHostProvider';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

document.documentElement.dataset.rendererDragRegions = window.whale.runtime.windowCapabilities
  .rendererDragRegions
  ? 'enabled'
  : 'disabled';

createRoot(root).render(
  <StrictMode>
    <PluginHostProvider>
      <App />
    </PluginHostProvider>
  </StrictMode>,
);
