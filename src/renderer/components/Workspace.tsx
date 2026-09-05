import { RenameThreadDialog } from './RenameThreadDialog';
import { SettingsDialog } from './SettingsDialog';
import { PluginMarketplaceDialog } from './PluginMarketplaceDialog';
import { useState, type CSSProperties } from 'react';
import { threadDisplayTitle } from '../../shared/display-text';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Archive,
  GitFork,
  MoreHorizontal,
  PanelRightOpen,
  Pencil,
  Puzzle,
  Trash2,
} from 'lucide-react';
import { activeTurnForThread } from '../state/conversation';
import { useAppStore } from '../state/store';
import { usePluginHost } from '../plugin-ui/PluginHostProvider';
import { PluginNavigationPage } from '../plugin-ui/PluginUiSurfaces';
import { Composer } from './Composer';
import { ConversationList } from './ConversationList';
import { DiffPanel } from './DiffPanel';
import { Sidebar } from './Sidebar';
import { ScheduledTasksPage } from './ScheduledTasksPage';
import { ArtifactsPage } from './ArtifactsPage';

export function Workspace() {
  const [panelWidth, setPanelWidth] = useState(360);
  const settingsOpen = useAppStore((state) => state.settingsOpen);
  const pluginMarketplaceOpen = useAppStore((state) => state.pluginMarketplaceOpen);
  const selectedThreadId = useAppStore((state) => state.selectedThreadId);
  const selectedThread = useAppStore((state) =>
    state.threads.find((thread) => thread.id === state.selectedThreadId),
  );
  const selectedProject = useAppStore((state) =>
    state.projects.find((project) => project.id === state.selectedProjectId),
  );
  const conversation = useAppStore((state) => state.conversation);
  const rightPanelOpen = useAppStore((state) => state.rightPanelOpen);
  const setRightPanel = useAppStore((state) => state.setRightPanel);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const forkThread = useAppStore((state) => state.forkThread);
  const archiveThread = useAppStore((state) => state.archiveThread);
  const deleteThread = useAppStore((state) => state.deleteThread);
  const brandName = useAppStore((state) => state.branding.name);
  const workspaceView = useAppStore((state) => state.workspaceView);
  const { descriptors, openAction } = usePluginHost();
  const threadActions = descriptors.flatMap((descriptor) => descriptor.uiContributions
    .flatMap((contribution) => contribution.type === 'action' && contribution.placement === 'threadToolbar'
      ? [{ descriptor, contribution }]
      : []))
    .sort((left, right) => left.contribution.order - right.contribution.order);
  const activeTurn = activeTurnForThread(conversation, selectedThreadId);
  const threadView = selectedThreadId ? conversation.threads[selectedThreadId] : null;
  const panelTurns = threadView?.turnOrder.flatMap((turnId) => {
    const turn = threadView.turns[turnId];
    return turn ? [turn] : [];
  }) ?? [];
  const pageOpen = settingsOpen || pluginMarketplaceOpen;
  const showDetails = !pageOpen && rightPanelOpen && Boolean(selectedThreadId);

  if (!pageOpen && workspaceView === 'schedules') {
    return (
      <div className="app-shell scheduled-tasks-shell">
        <Sidebar />
        <main className="scheduled-tasks-main"><ScheduledTasksPage /></main>
      </div>
    );
  }

  if (!pageOpen && workspaceView === 'artifacts') {
    return (
      <div className="app-shell artifacts-shell">
        <Sidebar />
        <main className="artifacts-main"><ArtifactsPage /></main>
      </div>
    );
  }

  if (!pageOpen && workspaceView === 'plugin') {
    return (
      <div className="app-shell plugin-navigation-shell">
        <Sidebar />
        <PluginNavigationPage />
      </div>
    );
  }

  return (
    <div className={`app-shell ${showDetails ? 'with-details' : ''}`} style={{ '--details-width': `${panelWidth}px` } as CSSProperties}>
      <Sidebar />
      <main className="workspace-main" hidden={pageOpen}>
        <header className="workspace-header">
          <div className="window-drag-spacer" />
          <div className="thread-heading" title={selectedThread?.cwd ?? selectedProject?.path}>
            <strong>{selectedThread ? threadDisplayTitle(selectedThread) : selectedProject?.name || brandName}</strong>
            <span>{selectedThread?.cwd ?? selectedProject?.path ?? '打开项目开始工作'}</span>
          </div>
          <div className="header-actions">
            {activeTurn && (
              <span className="running-indicator">
                <span className="spinner-dot" /> {brandName} 正在工作
              </span>
            )}
            {selectedThread && threadActions.map(({ descriptor, contribution }) => (
              <button
                className="plugin-thread-action-button"
                key={`${descriptor.pluginId}:${contribution.id}`}
                title={`${descriptor.displayName} · ${contribution.title}`}
                onClick={() => openAction({
                  pluginId: descriptor.pluginId,
                  contributionId: contribution.id,
                })}
              >
                <Puzzle size={14} />
                <span>{contribution.title}</span>
              </button>
            ))}
            {selectedThread && (
              <button
                className={`details-toggle-button ${rightPanelOpen ? 'active' : ''}`}
                aria-label="打开对话详情面板"
                aria-expanded={rightPanelOpen}
                onClick={() => setRightPanel(!rightPanelOpen)}
              >
                <PanelRightOpen size={14} /> 详情
              </button>
            )}
            {selectedThread && (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button className="icon-button" aria-label="对话操作">
                    <MoreHorizontal size={17} />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="menu-content" align="end" sideOffset={6}>
                    <DropdownMenu.Item
                      className="menu-item"
                      onSelect={() => {
                        setRenaming({ id: selectedThread.id, title: threadDisplayTitle(selectedThread) });
                      }}
                    >
                      <Pencil size={13} /> 重命名
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className="menu-item" onSelect={() => void forkThread()}>
                      <GitFork size={13} /> 创建分支
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className="menu-item" onSelect={() => void archiveThread()}>
                      <Archive size={13} /> 归档
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="menu-separator" />
                    <DropdownMenu.Item
                      className="menu-item danger"
                      onSelect={() => {
                        if (window.confirm('确定永久删除这个对话吗？')) void deleteThread();
                      }}
                    >
                      <Trash2 size={13} /> 删除
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            )}
          </div>
        </header>
        <div className="workspace-conversation">
          <ConversationList />
          <Composer />
        </div>
      </main>
      {pageOpen && <main className="workspace-page-main">
        {settingsOpen ? <SettingsDialog embedded /> : <PluginMarketplaceDialog embedded />}
      </main>}
      {renaming && <RenameThreadDialog key={renaming.id} thread={renaming} onClose={() => setRenaming(null)} />}
      {showDetails && <DiffPanel key={selectedThreadId} turns={panelTurns} width={panelWidth} onResize={(width) => setPanelWidth(Math.max(300, Math.min(560, width)))} />}
    </div>
  );
}
