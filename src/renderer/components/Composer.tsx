import { confirmAction } from '../state/confirmation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Database, ImagePlus, LoaderCircle, Paperclip, Pause, Puzzle, RotateCcw, Send, Sparkles, Square, Wrench, X } from 'lucide-react';
import type {
  ExplicitDynamicToolReference,
  ExplicitSkillReference,
  ExplicitToolReference,
  FileSearchResult,
  LocalAttachment,
} from '../../shared/types';
import { activeTurnForThread } from '../state/conversation';
import { commandDescriptions } from '../state/commands';
import { useAppStore } from '../state/store';
import { PluginUiFrame, composerContextFor } from '../plugin-ui/PluginUiFrame';
import { usePluginHost } from '../plugin-ui/PluginHostProvider';

export function Composer() {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [mentions, setMentions] = useState<Array<{ name: string; path: string }>>([]);
  const [explicitSkills, setExplicitSkills] = useState<ExplicitSkillReference[]>([]);
  const [explicitTools, setExplicitTools] = useState<ExplicitToolReference[]>([]);
  const [explicitDynamicTools, setExplicitDynamicTools] = useState<ExplicitDynamicToolReference[]>([]);
  const [fileResults, setFileResults] = useState<FileSearchResult[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityChoice[]>([]);
  const [capabilitiesLoaded, setCapabilitiesLoaded] = useState(false);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false);
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const [activeCapabilityIndex, setActiveCapabilityIndex] = useState(0);
  const [savingAttachments, setSavingAttachments] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileDragDepth = useRef(0);
  const sendComposer = useAppStore((state) => state.sendComposer);
  const { descriptors, composerContexts, openAction } = usePluginHost();
  const interrupt = useAppStore((state) => state.interrupt);
  const pause = useAppStore((state) => state.pause);
  const resumeTask = useAppStore((state) => state.resumeTask);
  const resumableTask = useAppStore((state) => state.resumableTask);
  const setNotice = useAppStore((state) => state.setNotice);
  const project = useAppStore((state) =>
    state.projects.find((candidate) => candidate.id === state.selectedProjectId),
  );
  const openSettings = useAppStore((state) => state.setSettingsOpen);
  const selectedThreadId = useAppStore((state) => state.selectedThreadId);
  const preferredModel = useAppStore((state) =>
    state.preferences.model
    || state.connectionSettings?.provider.model
    || state.models.find((model) => model.isDefault)?.model
    || state.models[0]?.model
    || '',
  );
  const submittedModel = useAppStore((state) =>
    state.selectedThreadId ? state.lastTaskByThread[state.selectedThreadId]?.model ?? '' : '',
  );
  const conversation = useAppStore((state) => state.conversation);
  const activeTurn = activeTurnForThread(conversation, selectedThreadId);
  const currentModel = activeTurn ? submittedModel || preferredModel : preferredModel;
  const composerWidgets = useMemo(() => descriptors
    .flatMap((descriptor) => descriptor.uiContributions
      .filter((contribution) => contribution.type === 'widget' && contribution.placement === 'composer')
      .map((contribution) => ({ descriptor, contribution })))
    .sort((left, right) => left.contribution.order - right.contribution.order), [descriptors]);
  const composerActions = useMemo(() => descriptors
    .flatMap((descriptor) => descriptor.uiContributions
      .flatMap((contribution) => contribution.type === 'action' && contribution.placement === 'composerToolbar'
        ? [{ descriptor, contribution }]
        : []))
    .sort((left, right) => left.contribution.order - right.contribution.order), [descriptors]);
  const composerContextContributions = useMemo(
    () => [...composerWidgets, ...composerActions],
    [composerActions, composerWidgets],
  );
  const slashQuery = /^\/([^\s]*)$/.exec(text.trim())?.[1] ?? null;
  const commandMatches = useMemo(
    () =>
      slashQuery === null
        ? []
        : commandDescriptions.filter((command) => command.name.startsWith(slashQuery)).slice(0, 8),
    [slashQuery],
  );
  const capabilityMatch = /(^|\s)\$([^\s$]*)$/.exec(text);
  const capabilityQuery = capabilityMatch?.[2].toLocaleLowerCase() ?? null;
  const capabilityMatches = useMemo(() => {
    if (capabilityQuery === null) return [];
    return capabilities.filter((capability) => {
      const haystack = capability.kind === 'skill'
        ? `${capability.name} ${capability.description}`
        : capability.kind === 'mcp'
          ? `${capability.server} ${capability.name} ${capability.title ?? ''} ${capability.description}`
          : `webmcp 插件动作 dynamic tool ${capability.pluginName} ${capability.name} ${capability.title} ${capability.description}`;
      return haystack.toLocaleLowerCase().includes(capabilityQuery);
    }).slice(0, 12);
  }, [capabilities, capabilityQuery]);

  useEffect(() => {
    setCapabilities([]);
    setCapabilitiesLoaded(false);
    setCapabilityError(null);
  }, [descriptors, project?.path]);

  useEffect(() => {
    if (capabilityQuery === null || capabilitiesLoaded) return;
    let cancelled = false;
    setCapabilitiesLoading(true);
    setCapabilityError(null);
    void Promise.all([
      window.whale.skills.list(project?.path ? { cwd: project.path } : {}),
      window.whale.mcp.list(),
    ]).then(([skillsResponse, mcpResponse]) => {
      if (cancelled) return;
      const choices = new Map<string, CapabilityChoice>();
      for (const entry of skillsResponse.data) {
        for (const skill of entry.skills) {
          if (!skill.enabled || !skill.pluginId) continue;
          choices.set(`skill:${skill.path}`, {
            kind: 'skill',
            name: skill.name,
            path: skill.path,
            description: skill.description,
          });
        }
      }
      for (const server of mcpResponse.data) {
        if (server.runtimeStatus === 'disabled') continue;
        for (const tool of Object.values(server.tools)) {
          if (!tool) continue;
          choices.set(`tool:${server.name}:${tool.name}`, {
            kind: 'mcp',
            server: server.name,
            name: tool.name,
            title: tool.title,
            description: tool.description ?? '',
          });
        }
      }
      for (const descriptor of descriptors) {
        for (const tool of descriptor.webMcp?.tools ?? []) {
          choices.set(`dynamic:${descriptor.pluginId}:${tool.name}`, {
            kind: 'webMcp',
            pluginId: descriptor.pluginId,
            pluginName: descriptor.displayName,
            name: tool.name,
            title: tool.title,
            description: tool.description,
          });
        }
      }
      setCapabilities(Array.from(choices.values()));
      setCapabilitiesLoaded(true);
    }).catch((error) => {
      if (cancelled) return;
      setCapabilityError(errorMessage(error));
    }).finally(() => {
      if (!cancelled) setCapabilitiesLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [capabilitiesLoaded, capabilityQuery, descriptors, project?.path]);

  useEffect(() => setActiveCapabilityIndex(0), [capabilityQuery]);

  useEffect(() => {
    const match = /(?:^|\s)@([^\s@]*)$/.exec(text);
    if (!match || !project) {
      setFileResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void window.whale.files.search(project.path, match[1]).then(setFileResults).catch(() => setFileResults([]));
    }, 140);
    return () => window.clearTimeout(timer);
  }, [project, text]);

  const submit = async () => {
    if (!text.trim() && attachments.length === 0) return;
    const activeContexts = selectedThreadId ? composerContextContributions.flatMap(({ descriptor, contribution }) => {
      const value = composerContextFor(
        composerContexts,
        descriptor,
        contribution,
        selectedThreadId,
      );
      return value ? [{ descriptor, contribution, value }] : [];
    }) : [];
    const pluginContexts = activeContexts.map(({ descriptor, contribution, value }) => ({
        pluginId: descriptor.pluginId,
        contributionId: contribution.id,
        label: value.label,
        value: value.value,
        ...(value.explicitTools?.length ? { toolHints: value.explicitTools } : {}),
      }));
    const sent = pluginContexts.length > 0
      ? await sendComposer(text, attachments, mentions, explicitSkills, explicitTools, explicitDynamicTools, pluginContexts)
      : await sendComposer(text, attachments, mentions, explicitSkills, explicitTools, explicitDynamicTools);
    if (sent) {
      setText('');
      setAttachments([]);
      setMentions([]);
      setExplicitSkills([]);
      setExplicitTools([]);
      setExplicitDynamicTools([]);
      setFileResults([]);
    }
  };

  const selectFile = (file: FileSearchResult) => {
    setText((current) => current.replace(/@[^\s@]*$/, `@${file.relativePath} `));
    setMentions((current) => [
      ...current.filter((mention) => mention.path !== file.path),
      { name: file.relativePath, path: file.path },
    ]);
    setFileResults([]);
    textareaRef.current?.focus();
  };

  const selectCapability = (capability: CapabilityChoice) => {
    const token = capabilityToken(capability);
    setText((current) => current.replace(
      /(^|\s)\$[^\s$]*$/,
      (_match, prefix: string) => `${prefix}${token} `,
    ));
    if (capability.kind === 'skill') {
      setExplicitSkills((current) => [
        ...current.filter((skill) => skill.path !== capability.path),
        { name: capability.name, path: capability.path },
      ]);
    } else if (capability.kind === 'mcp') {
      setExplicitTools((current) => [
        ...current.filter((tool) => tool.server !== capability.server || tool.name !== capability.name),
        { server: capability.server, name: capability.name },
      ]);
    } else {
      setExplicitDynamicTools((current) => [
        ...current.filter((tool) => tool.pluginId !== capability.pluginId || tool.name !== capability.name),
        { pluginId: capability.pluginId, name: capability.name },
      ]);
    }
    setActiveCapabilityIndex(0);
    textareaRef.current?.focus();
  };

  const removeSkill = (skill: ExplicitSkillReference) => {
    setExplicitSkills((current) => current.filter((value) => value.path !== skill.path));
    setText((current) => removeCapabilityToken(current, `$${skill.name}`));
  };

  const removeTool = (tool: ExplicitToolReference) => {
    setExplicitTools((current) => current.filter(
      (value) => value.server !== tool.server || value.name !== tool.name,
    ));
    setText((current) => removeCapabilityToken(current, `$${tool.server}.${tool.name}`));
  };

  const removeDynamicTool = (tool: ExplicitDynamicToolReference) => {
    setExplicitDynamicTools((current) => current.filter(
      (value) => value.pluginId !== tool.pluginId || value.name !== tool.name,
    ));
    setText((current) => removeCapabilityToken(current, `$${tool.name}`));
  };

  const addFileAttachments = async (files: File[]) => {
    const remaining = Math.max(0, 20 - attachments.length);
    if (remaining === 0) {
      setNotice('一次消息最多添加 20 个文件');
      return;
    }
    const selected = files.slice(0, remaining);
    setSavingAttachments(true);
    try {
      const saved = await Promise.all(
        selected.map(async (file) => window.whale.files.saveClipboardAttachment({
          dataUrl: await fileToDataUrl(file),
          name: file.name || 'clipboard-file',
        })),
      );
      setAttachments((current) => mergeAttachments(current, saved).slice(0, 20));
    } catch (error) {
      setNotice(`添加文件失败：${errorMessage(error)}`);
    } finally {
      setSavingAttachments(false);
    }
  };

  return (
    <div className="composer-area">
      <div
        className={`composer-shell${draggingFiles ? ' dragging-files' : ''}`}
        onDragEnter={(event) => {
          if (!selectedThreadId || !hasDraggedFiles(event.dataTransfer)) return;
          event.preventDefault();
          fileDragDepth.current += 1;
          setDraggingFiles(true);
        }}
        onDragOver={(event) => {
          if (!selectedThreadId || !hasDraggedFiles(event.dataTransfer)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={(event) => {
          if (!hasDraggedFiles(event.dataTransfer)) return;
          fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
          if (fileDragDepth.current === 0) setDraggingFiles(false);
        }}
        onDrop={(event) => {
          if (!selectedThreadId || !hasDraggedFiles(event.dataTransfer)) return;
          event.preventDefault();
          fileDragDepth.current = 0;
          setDraggingFiles(false);
          const files = Array.from(event.dataTransfer.files);
          if (files.length > 0) void addFileAttachments(files);
        }}
      >
        {draggingFiles && <div className="composer-drop-hint">松开以添加文件</div>}
        {(commandMatches.length > 0 || fileResults.length > 0 || capabilityQuery !== null) && (
          <div className="composer-suggestions">
            {commandMatches.map((command) => (
              <button key={command.name} onClick={() => setText(`/${command.name} `)}>
                <code>/{command.name}</code>
                <span>{command.description}</span>
              </button>
            ))}
            {fileResults.map((file) => (
              <button key={file.path} onClick={() => selectFile(file)}>
                <Paperclip size={13} />
                <span>{file.relativePath}</span>
              </button>
            ))}
            {capabilityQuery !== null && capabilitiesLoading && (
              <div className="composer-suggestion-status">
                <LoaderCircle className="spin" size={14} /> 正在读取已启用的 Skills、MCP 工具与 WebMCP…
              </div>
            )}
            {capabilityQuery !== null && capabilityError && (
              <div className="composer-suggestion-status composer-suggestion-error">
                读取工具失败：{capabilityError}
              </div>
            )}
            {capabilityQuery !== null && !capabilitiesLoading && !capabilityError
              && capabilitiesLoaded && capabilityMatches.length === 0 && (
              <div className="composer-suggestion-status">没有匹配的已启用 Skill、MCP 工具或 WebMCP</div>
            )}
            {capabilityQuery !== null && capabilityMatches.map((capability, index) => (
              <button
                key={capabilityKey(capability)}
                className={index === activeCapabilityIndex ? 'active' : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectCapability(capability)}
              >
                <span className={`composer-suggestion-icon ${capability.kind}`}>
                  {capability.kind === 'skill'
                    ? <Sparkles size={14} />
                    : capability.kind === 'webMcp' ? <Puzzle size={14} /> : <Wrench size={14} />}
                </span>
                <span className="composer-suggestion-copy">
                  <strong>{capabilityLabel(capability)}</strong>
                  <small>{capability.description || capabilityKindLabel(capability)}</small>
                </span>
                <em>{capabilityKindLabel(capability)}</em>
              </button>
            ))}
          </div>
        )}
        {(attachments.length > 0 || mentions.length > 0 || explicitSkills.length > 0 || explicitTools.length > 0 || explicitDynamicTools.length > 0) && (
          <div className="composer-attachments">
            {attachments.map((attachment) => (
              <span key={attachment.path}>
                {attachment.kind === 'image' ? <ImagePlus size={12} /> : <Paperclip size={12} />}
                {' '}{attachment.name}
                <button
                  aria-label={`移除文件 ${attachment.name}`}
                  onClick={() => setAttachments(attachments.filter((value) => value.path !== attachment.path))}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            {mentions.map((mention) => (
              <span key={mention.path}>
                <Paperclip size={12} /> {mention.name}
                <button
                  aria-label="移除文件引用"
                  onClick={() => setMentions(mentions.filter((value) => value.path !== mention.path))}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            {explicitSkills.map((skill) => (
              <span className="capability-chip skill" key={skill.path}>
                <Sparkles size={12} /> {skill.name}
                <button aria-label={`移除 Skill ${skill.name}`} onClick={() => removeSkill(skill)}>
                  <X size={11} />
                </button>
              </span>
            ))}
            {explicitTools.map((tool) => (
              <span className="capability-chip tool" key={`${tool.server}:${tool.name}`}>
                <Wrench size={12} /> {tool.server}.{tool.name}
                <button aria-label={`移除工具 ${tool.name}`} onClick={() => removeTool(tool)}>
                  <X size={11} />
                </button>
              </span>
            ))}
            {explicitDynamicTools.map((tool) => (
              <span className="capability-chip webMcp" key={`${tool.pluginId}:${tool.name}`}>
                <Puzzle size={12} /> {tool.name}
                <button aria-label={`移除插件动作 ${tool.name}`} onClick={() => removeDynamicTool(tool)}>
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={text}
          disabled={!selectedThreadId}
          rows={1}
          title="@ 引用文件 · $ 选择技能或工具 · / 使用命令"
          placeholder={selectedThreadId ? '描述你想完成的任务…' : '请先创建或选择对话'}
          onChange={(event) => {
            const nextText = event.target.value;
            setText(nextText);
            setExplicitSkills((current) => current.filter((skill) => nextText.includes(`$${skill.name}`)));
            setExplicitTools((current) => current.filter(
              (tool) => nextText.includes(`$${tool.server}.${tool.name}`),
            ));
            event.target.style.height = 'auto';
            event.target.style.height = `${Math.min(event.target.scrollHeight, 220)}px`;
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.items)
              .filter((item) => item.kind === 'file')
              .map((item) => item.getAsFile())
              .filter((file): file is File => file !== null);
            if (!files.length) return;
            event.preventDefault();
            void addFileAttachments(files);
          }}
          onKeyDown={(event) => {
            if (capabilityQuery !== null && capabilityMatches.length > 0 && event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveCapabilityIndex((current) => (current + 1) % capabilityMatches.length);
            } else if (capabilityQuery !== null && capabilityMatches.length > 0 && event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveCapabilityIndex((current) => (current - 1 + capabilityMatches.length) % capabilityMatches.length);
            } else if (capabilityQuery !== null && capabilityMatches.length > 0
              && event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              selectCapability(capabilityMatches[Math.min(activeCapabilityIndex, capabilityMatches.length - 1)]);
            } else if (capabilityQuery !== null && event.key === 'Escape') {
              event.preventDefault();
              setText((current) => current.replace(/(^|\s)\$[^\s$]*$/, '$1'));
            } else if (event.key === 'Escape' && activeTurn) {
              event.preventDefault();
              void interrupt();
            } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="composer-footer">
          <div className="composer-tools">
            <button
              className="icon-button"
              aria-label="添加文件"
              disabled={!selectedThreadId}
              onClick={() =>
                void window.whale.files.pickAttachments()
                  .then((selected) => setAttachments((current) => mergeAttachments(current, selected).slice(0, 20)))
                  .catch((error) => setNotice(`添加文件失败：${errorMessage(error)}`))
              }
            >
              <Paperclip size={16} />
            </button>
            {selectedThreadId && composerWidgets.length > 0 && (
              <div className="plugin-composer-widgets">
                {composerWidgets.map(({ descriptor, contribution }) => (
                  <div
                    className="plugin-composer-widget"
                    key={`${descriptor.pluginId}:${contribution.id}:${selectedThreadId}`}
                  >
                    <PluginUiFrame
                      descriptor={descriptor}
                      contribution={contribution}
                      threadId={selectedThreadId}
                      className="plugin-composer-frame"
                    />
                  </div>
                ))}
              </div>
            )}
            {selectedThreadId && composerActions.map(({ descriptor, contribution }) => (
              <button
                className={contribution.id === 'knowledge-composer-action' ? 'icon-button' : 'plugin-composer-action'}
                key={`${descriptor.pluginId}:${contribution.id}`}
                title={`${descriptor.displayName} · ${contribution.title}`}
                aria-label={contribution.title}
                onClick={() => openAction({
                  pluginId: descriptor.pluginId,
                  contributionId: contribution.id,
                })}
              >
                {contribution.id === 'knowledge-composer-action'
                  ? <Database size={16} aria-hidden="true" />
                  : <><Puzzle size={14} /><span>{contribution.title}</span></>}
              </button>
            ))}
            {savingAttachments && <span className="composer-saving-indicator">正在保存…</span>}
          </div>
          <div className="composer-submit-controls">
            {selectedThreadId && currentModel && (
              <button
                type="button"
                onClick={() => openSettings(true)}
                className="composer-model-indicator"
                aria-label={`当前模型：${currentModel}`}
                title={`当前模型：${currentModel}`}
              >
                <Sparkles size={12} />
                <span>{currentModel}</span>
              </button>
            )}
            {activeTurn ? (
              <div className="turn-control-buttons">
                <button className="send-button secondary pause-button" aria-label="暂停当前任务" title="暂停，可稍后继续" onClick={() => void pause()}>
                  <Pause size={14} fill="currentColor" />
                </button>
                <button className="send-button secondary stop-button" aria-label="取消当前回合" title="取消" onClick={() => void interrupt()}>
                  <Square size={13} fill="currentColor" />
                </button>
              </div>
            ) : resumableTask?.threadId === selectedThreadId ? (
              <button
                className="send-button primary resume-button"
                aria-label="继续任务"
                title="继续任务"
                onClick={async () => {
                  const needsConfirmation = resumableTask.status !== 'paused';
                  if (!needsConfirmation || await confirmAction(
                    resumableTask.status === 'failed'
                      ? '确认在新回合中重试失败任务？'
                      : '确认在新回合中继续异常中断的任务？',
                  )) void resumeTask();
                }}
              >
                <RotateCcw size={14} />
              </button>
            ) : (
              <button
                className="send-button primary"
                aria-label="发送"
                disabled={!selectedThreadId || (!text.trim() && attachments.length === 0)}
                onClick={() => void submit()}
              >
                <Send size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type CapabilityChoice =
  | {
      kind: 'skill';
      name: string;
      path: string;
      description: string;
    }
  | {
      kind: 'mcp';
      server: string;
      name: string;
      title?: string;
      description: string;
    }
  | {
      kind: 'webMcp';
      pluginId: string;
      pluginName: string;
      name: string;
      title: string;
      description: string;
    };

function capabilityKey(capability: CapabilityChoice): string {
  if (capability.kind === 'skill') return `skill:${capability.path}`;
  return capability.kind === 'mcp'
    ? `tool:${capability.server}:${capability.name}`
    : `dynamic:${capability.pluginId}:${capability.name}`;
}

function capabilityLabel(capability: CapabilityChoice): string {
  if (capability.kind === 'skill' || capability.kind === 'webMcp') return capability.name;
  return `${capability.server}.${capability.name}`;
}

function capabilityKindLabel(capability: CapabilityChoice): string {
  if (capability.kind === 'skill') return 'Skill';
  return capability.kind === 'webMcp' ? 'WebMCP' : 'MCP 工具';
}

function capabilityToken(capability: CapabilityChoice): string {
  return `$${capabilityLabel(capability)}`;
}

function removeCapabilityToken(text: string, token: string): string {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text
    .replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'g'), '$1')
    .replace(/[ \t]{2,}/g, ' ');
}

function fileToDataUrl(file: File): Promise<string> {
  if (file.size > 50 * 1024 * 1024) return Promise.reject(new Error('文件超过 50 MB'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('无法读取剪贴板文件'));
    reader.onerror = () => reject(reader.error ?? new Error('无法读取剪贴板文件'));
    reader.readAsDataURL(file);
  });
}

function hasDraggedFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes('Files');
}

function mergeAttachments(current: LocalAttachment[], incoming: LocalAttachment[]): LocalAttachment[] {
  const byPath = new Map(current.map((attachment) => [attachment.path, attachment]));
  for (const attachment of incoming) byPath.set(attachment.path, attachment);
  return Array.from(byPath.values());
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
