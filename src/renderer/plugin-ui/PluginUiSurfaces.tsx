import * as Dialog from '@radix-ui/react-dialog';
import { PanelTopOpen, X } from 'lucide-react';
import { useAppStore } from '../state/store';
import type { PluginUiContribution } from '../../shared/plugin-ui';
import { PluginUiFrame } from './PluginUiFrame';
import { findPluginUiContribution, usePluginUi } from './PluginUiProvider';

export function PluginNavigationPage() {
  const { activeNavigation, descriptors } = usePluginUi();
  const selectedThreadId = useAppStore((state) => state.selectedThreadId);
  if (!activeNavigation) return <UnavailableNavigationPage />;
  const resolved = findPluginUiContribution(descriptors, activeNavigation, 'navigation.page');
  if (!resolved || resolved.contribution.type !== 'navigation.page') {
    return <UnavailableNavigationPage />;
  }
  const { descriptor, contribution } = resolved;
  return (
    <main className="plugin-navigation-main">
      <header className="plugin-navigation-header">
        <div className="window-drag-spacer" />
        <div>
          <strong>{contribution.title}</strong>
          <span>{descriptor.displayName}</span>
        </div>
      </header>
      <div className="plugin-navigation-content">
        <PluginUiFrame
          key={`${descriptor.pluginId}:${contribution.id}`}
          descriptor={descriptor}
          contribution={contribution}
          threadId={selectedThreadId}
          className="plugin-navigation-frame"
          fallback={<p className="plugin-surface-fallback">插件页面暂时不可用。</p>}
        />
      </div>
    </main>
  );
}

export function PluginActionDialog() {
  const { activeAction, closeAction, descriptors } = usePluginUi();
  const selectedThreadId = useAppStore((state) => state.selectedThreadId);
  const resolved = activeAction ? findPluginUiContribution(descriptors, activeAction) : null;
  const actionable = resolved && isPluginAction(resolved.contribution) ? {
    descriptor: resolved.descriptor,
    contribution: resolved.contribution,
  } : null;

  return (
    <Dialog.Root open={Boolean(actionable)} onOpenChange={(open) => { if (!open) closeAction(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay plugin-action-overlay" />
        {actionable && (
          <Dialog.Content className="plugin-action-dialog">
            <header className="plugin-action-header">
              <span className="tool-icon teal"><PanelTopOpen size={15} /></span>
              <div>
                <Dialog.Title>{actionable.contribution.title}</Dialog.Title>
                <Dialog.Description>{actionable.descriptor.displayName}</Dialog.Description>
              </div>
              <Dialog.Close className="icon-button" aria-label="关闭插件操作">
                <X size={16} />
              </Dialog.Close>
            </header>
            <div className="plugin-action-content">
              <PluginUiFrame
                key={`${actionable.descriptor.pluginId}:${actionable.contribution.id}:${selectedThreadId ?? 'global'}`}
                descriptor={actionable.descriptor}
                contribution={actionable.contribution}
                threadId={selectedThreadId}
                className="plugin-action-frame"
                fallback={<p className="plugin-surface-fallback">插件操作暂时不可用。</p>}
              />
            </div>
          </Dialog.Content>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function isPluginAction(
  contribution: PluginUiContribution,
): contribution is Extract<PluginUiContribution, {
  type: 'command.action' | 'thread.toolbarAction' | 'composer.action';
}> {
  return contribution.type === 'command.action'
    || contribution.type === 'thread.toolbarAction'
    || contribution.type === 'composer.action';
}

function UnavailableNavigationPage() {
  return (
    <main className="plugin-navigation-main plugin-navigation-unavailable">
      <PanelTopOpen size={24} />
      <strong>插件页面不可用</strong>
      <span>插件可能已停用、卸载或更新。</span>
    </main>
  );
}
