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
  const renameThread = useAppStore((state) => state.renameThread);
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
  const showDetails = rightPanelOpen && Boolean(selectedThreadId);

  if (workspaceView === 'schedules') {
    return (
      <div className="app-shell scheduled-tasks-shell">
        <Sidebar />
        <main className="scheduled-tasks-main"><ScheduledTasksPage /></main>
      </div>
    );
  }

  if (workspaceView === 'artifacts') {
    return (
      <div className="app-shell artifacts-shell">
        <Sidebar />
        <main className="artifacts-main"><ArtifactsPage /></main>
      </div>
    );
  }

  if (workspaceView === 'plugin') {
    return (
      <div className="app-shell plugin-navigation-shell">
        <Sidebar />
        <PluginNavigationPage />
      </div>
    );
  }

  return (
    <div className={`app-shell ${showDetails ? 'with-details' : ''}`}>
      <Sidebar />
      <main className="workspace-main">
        <header className="workspace-header">
          <div className="window-drag-spacer" />
          <div className="thread-heading">
            <strong>{selectedThread?.name || selectedThread?.preview || selectedProject?.name || brandName}</strong>
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
                  <button className="icon-button" aria-label="线程操作">
                    <MoreHorizontal size={17} />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="menu-content" align="end" sideOffset={6}>
                    <DropdownMenu.Item
                      className="menu-item"
                      onSelect={() => {
                        const value = window.prompt(
                          '输入线程名称',
                          selectedThread.name ?? selectedThread.preview,
                        );
                        if (value?.trim()) void renameThread(value.trim());
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
                        if (window.confirm('确定永久删除这个线程吗？')) void deleteThread();
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
      {showDetails && <DiffPanel key={selectedThreadId} turns={panelTurns} />}
    </div>
  );
}
