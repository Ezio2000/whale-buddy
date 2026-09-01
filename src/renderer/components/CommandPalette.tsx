import * as Dialog from '@radix-ui/react-dialog';
import { CornerDownLeft, Puzzle, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { commandDescriptions } from '../state/commands';
import { useAppStore } from '../state/store';
import { usePluginHost } from '../plugin-ui/PluginHostProvider';

export function CommandPalette() {
  const open = useAppStore((state) => state.commandPaletteOpen);
  const setOpen = useAppStore((state) => state.setCommandPaletteOpen);
  const threads = useAppStore((state) => state.threads);
  const send = useAppStore((state) => state.sendComposer);
  const selectThread = useAppStore((state) => state.selectThread);
  const [query, setQuery] = useState('');
  const { descriptors, openAction } = usePluginHost();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const normalized = query.trim().toLocaleLowerCase();
  const commands = useMemo(
    () =>
      commandDescriptions.filter(
        (command) =>
          !normalized ||
          command.name.includes(normalized.replace(/^\//, '')) ||
          command.description.includes(normalized),
      ),
    [normalized],
  );
  const matchedThreads = useMemo(
    () =>
      normalized
        ? threads
            .filter((thread) =>
              `${thread.name ?? ''} ${thread.preview}`.toLocaleLowerCase().includes(normalized),
            )
            .slice(0, 8)
        : [],
    [normalized, threads],
  );
  const pluginCommands = useMemo(() => descriptors.flatMap((descriptor) =>
    descriptor.uiContributions
      .flatMap((contribution) => contribution.type === 'action' && contribution.placement === 'commandPalette'
        ? [{ descriptor, contribution }]
        : []))
    .filter(({ descriptor, contribution }) => !normalized || [
      descriptor.displayName,
      contribution.title,
      contribution.description,
      ...contribution.keywords,
    ].join(' ').toLocaleLowerCase().includes(normalized))
    .sort((left, right) => left.contribution.order - right.contribution.order), [descriptors, normalized]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay palette-overlay" />
        <Dialog.Content className="command-palette">
          <Dialog.Title className="sr-only">命令面板</Dialog.Title>
          <div className="palette-search">
            <Search size={17} />
            <input
              ref={inputRef}
              value={query}
              placeholder="搜索命令或线程…"
              onChange={(event) => setQuery(event.target.value)}
            />
            <Dialog.Close className="keycap" aria-label="关闭">
              esc
            </Dialog.Close>
          </div>
          <div className="palette-results">
            <div className="palette-group-label">命令</div>
            {commands.map((command) => (
              <button
                key={command.name}
                onClick={() => {
                  setOpen(false);
                  void send(`/${command.name}`);
                }}
              >
                <code>/{command.name}</code>
                <span>{command.description}</span>
                <CornerDownLeft size={13} />
              </button>
            ))}
            {pluginCommands.length > 0 && (
              <>
                <div className="palette-group-label">插件命令</div>
                {pluginCommands.map(({ descriptor, contribution }) => (
                  <button
                    key={`${descriptor.pluginId}:${contribution.id}`}
                    onClick={() => {
                      setOpen(false);
                      openAction({
                        pluginId: descriptor.pluginId,
                        contributionId: contribution.id,
                      });
                    }}
                  >
                    <span className="palette-plugin-command"><Puzzle size={14} /> {contribution.title}</span>
                    <small>{contribution.description || descriptor.displayName}</small>
                    <CornerDownLeft size={13} />
                  </button>
                ))}
              </>
            )}
            {matchedThreads.length > 0 && (
              <>
                <div className="palette-group-label">线程</div>
                {matchedThreads.map((thread) => (
                  <button
                    key={thread.id}
                    onClick={() => {
                      setOpen(false);
                      void selectThread(thread.id);
                    }}
                  >
                    <span>{thread.name || thread.preview || '未命名线程'}</span>
                    <small>{thread.cwd}</small>
                  </button>
                ))}
              </>
            )}
            {commands.length === 0 && pluginCommands.length === 0 && matchedThreads.length === 0 && (
              <div className="palette-empty">没有匹配结果</div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
