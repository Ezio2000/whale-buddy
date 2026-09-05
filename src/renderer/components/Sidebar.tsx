import { confirmAction } from '../state/confirmation';
import { useState } from 'react';
import { RenameThreadDialog } from './RenameThreadDialog';
import { threadDisplayTitle } from '../../shared/display-text';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Archive,
  CalendarClock,
  ChevronDown,
  Folder,
  FolderOpen,
  FileArchive,
  GitFork,
  MoreHorizontal,
  PanelTopOpen,
  PackageOpen,
  Plus,
  Settings,
  Trash2,
} from 'lucide-react';
import type { LocalProject, ThreadSummary } from '../../shared/types';
import { useAppStore } from '../state/store';
import { usePluginHost } from '../plugin-ui/PluginHostProvider';
import { BrandMark } from './BrandMark';
import { AccountButton } from './AccountButton';

export function Sidebar() {
  const projects = useAppStore((state) => state.projects);
  const threads = useAppStore((state) => state.threads);
  const selectedProjectId = useAppStore((state) => state.selectedProjectId);
  const selectedThreadId = useAppStore((state) => state.selectedThreadId);
  const openProject = useAppStore((state) => state.openProject);
  const selectProject = useAppStore((state) => state.selectProject);
  const selectThread = useAppStore((state) => state.selectThread);
  const newThread = useAppStore((state) => state.newThread);
  const removeProject = useAppStore((state) => state.removeProject);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const forkThread = useAppStore((state) => state.forkThread);
  const archiveThread = useAppStore((state) => state.archiveThread);
  const deleteThread = useAppStore((state) => state.deleteThread);
  const openSettings = useAppStore((state) => state.setSettingsOpen);
  const openPluginMarketplace = useAppStore((state) => state.setPluginMarketplaceOpen);
  const brandName = useAppStore((state) => state.branding.name);
  const settingsOpen = useAppStore((state) => state.settingsOpen);
  const pluginMarketplaceOpen = useAppStore((state) => state.pluginMarketplaceOpen);
  const workspaceView = useAppStore((state) => state.workspaceView);
  const setWorkspaceView = useAppStore((state) => state.setWorkspaceView);
  const pageActive = !settingsOpen && !pluginMarketplaceOpen;
  const { activeNavigation, descriptors, selectNavigation } = usePluginHost();
  const navigationPages = descriptors.flatMap((descriptor) => descriptor.uiContributions
    .filter((contribution) => contribution.type === 'page' && contribution.placement === 'navigation')
    .map((contribution) => ({ descriptor, contribution })))
    .sort((left, right) => left.contribution.order - right.contribution.order);
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const projectThreads = selectedProject
    ? threads.filter((thread) => ownerProject(thread, projects)?.id === selectedProject.id)
    : [];

  return (
    <aside className="sidebar">
      <div className="sidebar-drag-region" />
      <div className="sidebar-brand">
        <BrandMark size={27} />
        <span>{brandName}</span>
      </div>

      <nav className="sidebar-nav">
        <button
          className="new-thread-button"
          disabled={!selectedProject}
          onClick={() => { setWorkspaceView('conversation'); void newThread(); }}
        >
          <Plus size={16} />
          <span>新对话</span>
        </button>
        <button
          className={pageActive && workspaceView === 'artifacts' ? 'active' : ''}
          onClick={() => setWorkspaceView('artifacts')}
        >
          <FileArchive size={15} />
          <span>成果库</span>
        </button>
        <button
          className={pageActive && workspaceView === 'schedules' ? 'active' : ''}
          onClick={() => setWorkspaceView('schedules')}
        >
          <CalendarClock size={15} />
          <span>定时任务</span>
        </button>
        <button className={pluginMarketplaceOpen ? 'active' : ''} onClick={() => openPluginMarketplace(true)}>
          <PackageOpen size={15} />
          <span>插件商城</span>
        </button>
        <button className={settingsOpen ? 'active' : ''} onClick={() => openSettings(true)}>
          <Settings size={15} />
          <span>设置</span>
        </button>
      </nav>

      <section className="sidebar-section project-section">
        <div className="sidebar-section-heading">
          <span>项目</span>
          <button className="icon-button" aria-label="打开项目" onClick={() => void openProject()}>
            <Plus size={15} />
          </button>
        </div>
        <div className="project-list">
          {projects.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              selected={project.id === selectedProjectId}
              onSelect={() => {
                setWorkspaceView('conversation');
                selectProject(project.id);
              }}
              onRemove={() => void removeProject(project.id)}
            />
          ))}
          {projects.length === 0 && (
            <button className="empty-project-button" onClick={() => void openProject()}>
              <FolderOpen size={17} />
              <span>打开第一个项目</span>
            </button>
          )}
        </div>
      </section>

      <section className="sidebar-section threads-section">
        <div className="sidebar-section-heading">
          <span>最近</span>
        </div>

        <div className="thread-list">
          {projectThreads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              selected={pageActive && workspaceView === 'conversation' && thread.id === selectedThreadId}
              onSelect={() => {
                setWorkspaceView('conversation');
                void selectThread(thread.id);
              }}
              onRename={() => {
                setRenaming({ id: thread.id, title: threadDisplayTitle(thread) });
              }}
              onFork={() => void forkThread(thread.id)}
              onArchive={() => void archiveThread(thread.id)}
              onDelete={async () => {
                if (await confirmAction('确定永久删除这个对话吗？此操作无法撤销。', { confirmLabel: '永久删除', danger: true }))
                  void deleteThread(thread.id);
              }}
            />
          ))}
          {selectedProject && projectThreads.length === 0 && (
            <div className="empty-thread-list">
              <span>这个项目还没有对话</span>
              <button onClick={() => { setWorkspaceView('conversation'); void newThread(); }}>新建对话</button>
            </div>
          )}
        </div>
      </section>

      {navigationPages.length > 0 && (
        <section className="sidebar-section plugin-navigation-section">
          <div className="sidebar-section-heading"><span>插件页面</span></div>
          <div className="plugin-navigation-list">
            {navigationPages.map(({ descriptor, contribution }) => {
              const active = pageActive && workspaceView === 'plugin'
                && activeNavigation?.pluginId === descriptor.pluginId
                && activeNavigation.contributionId === contribution.id;
              return (
                <button
                  className={active ? 'active' : ''}
                  key={`${descriptor.pluginId}:${contribution.id}`}
                  title={`${descriptor.displayName} · ${contribution.title}`}
                  onClick={() => {
                    selectNavigation({
                      pluginId: descriptor.pluginId,
                      contributionId: contribution.id,
                    });
                    setWorkspaceView('plugin');
                  }}
                >
                  <PanelTopOpen size={15} />
                  <span>{contribution.title}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <div className="sidebar-footer">
        <AccountButton />
      </div>
      {renaming && <RenameThreadDialog key={renaming.id} thread={renaming} onClose={() => setRenaming(null)} />}
    </aside>
  );
}

function ProjectRow({
  project,
  selected,
  onSelect,
  onRemove,
}: {
  project: LocalProject;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  return (
    <div className={`project-row ${selected ? 'selected' : ''}`}>
      <button className="project-main" onClick={onSelect} title={project.path}>
        <Folder size={15} fill={selected ? 'currentColor' : 'none'} />
        <span>{project.name}</span>
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="row-more" aria-label={`${project.name} 更多操作`}>
            <MoreHorizontal size={14} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu-content" sideOffset={5} align="start">
            <DropdownMenu.Item className="menu-item danger" onSelect={onRemove}>
              <Trash2 size={13} /> 从列表移除
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

function ThreadRow({
  thread,
  selected,
  onSelect,
  onRename,
  onFork,
  onArchive,
  onDelete,
}: {
  thread: ThreadSummary;
  selected: boolean;
  onSelect: () => void;
  onRename: () => void;
  onFork: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const active = record(thread.status)?.type === 'active';
  return (
    <div className={`thread-row ${selected ? 'selected' : ''}`}>
      <button className="thread-main" onClick={onSelect}>
        <span className={`thread-status-dot ${active ? 'active' : ''}`} />
        <span className="thread-copy">
          <strong>{threadDisplayTitle(thread)}</strong>
          <small>{relativeTime(thread.updatedAt)}</small>
        </span>
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="row-more" aria-label="对话操作">
            <MoreHorizontal size={14} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu-content" sideOffset={5} align="start">
            <DropdownMenu.Item className="menu-item" onSelect={onRename}>
              重命名
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item" onSelect={onFork}>
              <GitFork size={13} /> 创建分支
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item" onSelect={onArchive}>
              <Archive size={13} /> 归档
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="menu-separator" />
            <DropdownMenu.Item className="menu-item danger" onSelect={onDelete}>
              <Trash2 size={13} /> 删除
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

function ownerProject(thread: ThreadSummary, projects: LocalProject[]): LocalProject | null {
  const cwd = normalizePath(thread.cwd);
  return (
    projects
      .filter((project) => {
        const root = normalizePath(project.path);
        return root === '/' ? cwd.startsWith('/') : cwd === root || cwd.startsWith(`${root}/`);
      })
      .sort((left, right) => right.path.length - left.path.length)[0] ?? null
  );
}

function normalizePath(value: string): string {
  return value.replace(/\/+$/, '') || '/';
}

function relativeTime(timestampSeconds: number): string {
  const delta = Date.now() - timestampSeconds * 1_000;
  if (delta < 60_000) return '刚刚';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  return `${Math.floor(delta / 86_400_000)} 天前`;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
