import { confirmAction } from '../state/confirmation';
import { SettingsSurface } from './SettingsSurface';
import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  SlidersHorizontal,
  Shield,
  Sun,
  UserRound,
  Settings,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Image,
  LoaderCircle,
  RotateCcw,
  Save,
  X,
} from 'lucide-react';
import type {
  RuntimeBrandingSettingsInput,
  RuntimeConnectionSettingsInput,
  RuntimeReasoningEffort,
} from '../../shared/types';
import { useAppStore, type Preferences } from '../state/store';
import { BrandMark } from './BrandMark';

export function SettingsDialog({ embedded = false }: { embedded?: boolean }) {
  const Title = embedded ? 'h1' : Dialog.Title;
  const Description = embedded ? 'p' : Dialog.Description;
  const [category, setCategory] = useState('model');
  const categories = [['model', '模型与回答'], ['permissions', '执行权限'], ['appearance', '外观'], ['account', '账号'], ['advanced', '高级']] as const;
  const categoryIcons = [SlidersHorizontal, Shield, Sun, UserRound, Settings];
  const open = useAppStore((state) => state.settingsOpen);
  const setOpen = useAppStore((state) => state.setSettingsOpen);
  const preferences = useAppStore((state) => state.preferences);
  const update = useAppStore((state) => state.updatePreferences);
  const connectionSettings = useAppStore((state) => state.connectionSettings);
  const applyRuntimeSettings = useAppStore((state) => state.applyRuntimeSettings);
  const branding = useAppStore((state) => state.branding);
  const applyBrandingSettings = useAppStore((state) => state.applyBrandingSettings);
  const [connectionDraft, setConnectionDraft] = useState<RuntimeConnectionSettingsInput>(() =>
    draftFromSettings(connectionSettings),
  );
  const [saving, setSaving] = useState(false);
  const [revealingApiKey, setRevealingApiKey] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [brandingDraft, setBrandingDraft] = useState<RuntimeBrandingSettingsInput>(() => ({
    name: branding.name,
    iconPath: branding.iconPath,
  }));
  const [savingBranding, setSavingBranding] = useState(false);
  const [brandingMessage, setBrandingMessage] = useState<string | null>(null);
  const [authIssuer, setAuthIssuer] = useState('');
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [savingAuth, setSavingAuth] = useState(false);
  const [auditCount, setAuditCount] = useState<number | null>(null);
  const [auditMessage, setAuditMessage] = useState<string | null>(null);

  useEffect(() => {
    setConnectionDraft(draftFromSettings(connectionSettings));
    setShowApiKey(false);
    setRevealingApiKey(false);
    setConnectionMessage(null);
    setBrandingDraft({ name: branding.name, iconPath: branding.iconPath });
    setBrandingMessage(null);
    setAuthMessage(null);
    setAuditMessage(null);
    if (typeof window.whale?.auth?.settings === 'function') {
      void window.whale.auth.settings().then((settings) => setAuthIssuer(settings.issuer));
    }
    if (typeof window.whale?.audit?.list === 'function') {
      void window.whale.audit.list().then((records) => setAuditCount(records.length));
    }
  }, [open]);

  const capabilities = connectionDraft.provider.capabilities;
  const effortOptions: Array<{ value: string; label: string }> = capabilities.reasoningEfforts.map((effort) => ({
    value: effort,
    label: reasoningEffortLabel(effort),
  }));
  if (!effortOptions.some((option) => option.value === preferences.effort)) {
    effortOptions.push({
      value: preferences.effort,
      label: reasoningEffortLabel(preferences.effort),
    });
  }
  const executionPreset = executionPresetFor(preferences);
  const executionPresetOptions = [
    { value: 'safe', label: '安全只读' },
    { value: 'recommended', label: '标准代理（推荐）' },
    { value: 'model-request', label: '模型按需申请' },
    { value: 'yolo', label: 'YOLO（完全访问且不审批）' },
    ...(executionPreset === 'custom'
      ? [{ value: 'custom', label: '自定义组合' }]
      : []),
  ];
  const saveConnection = async () => {
    setSaving(true);
    setConnectionMessage(null);
    try {
      const saved = await applyRuntimeSettings(connectionDraft);
      setConnectionDraft(draftFromSettings(saved));
      setShowApiKey(false);
      setConnectionMessage('设置已生效，模型服务已重新连接。');
    } catch (error) {
      setConnectionMessage(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSurface embedded={embedded} open={open} onOpenChange={setOpen} className="settings-dialog">
          <div className="dialog-heading">
            <div>
              <Title>{embedded ? categories.find(([id]) => id === category)?.[1] : '设置'}</Title>
              <Description>配置 {branding.name} 的模型服务、使用偏好与安全选项。</Description>
            </div>
            {!embedded && <button onClick={() => setOpen(false)} className="icon-button dialog-close-target" aria-label="关闭设置">
              <X size={16} />
            </button>}
          </div>
          <nav className="settings-categories" aria-label="设置分类">
            {embedded && <button className="settings-back" onClick={() => setOpen(false)}><ArrowLeft size={18} />返回应用</button>}
            {embedded && <span className="settings-nav-label">设置</span>}
            {categories.map(([id, label], index) => {
              const Icon = categoryIcons[index];
              return <button key={id} aria-current={category === id ? 'page' : undefined} className={category === id ? 'active' : ''} onClick={() => setCategory(id)}><Icon size={18} />{label}</button>;
            })}
          </nav>
          <div className="settings-groups">
            <section hidden={category !== 'model'}>
              <h3>模型服务</h3>
              <div className="settings-section-body">
              <p className="settings-section-intro">只需填写服务地址、模型名称和 API Key。</p>
              <div className="provider-fields">
                  <SettingRow label="服务地址" hint="由你的模型服务提供方给出，通常以 /v1 结尾。">
                    <TextField
                      ariaLabel="模型服务地址"
                      value={connectionDraft.provider.baseUrl}
                      placeholder="https://gateway.example/v1"
                      onChange={(baseUrl) => updateProviderDraft(setConnectionDraft, { baseUrl })}
                    />
                  </SettingRow>
                  <SettingRow label="模型名称" hint="填写服务提供方给你的模型名称。">
                    <TextField
                      ariaLabel="自定义模型名称"
                      value={connectionDraft.provider.model}
                      placeholder="model-name"
                      onChange={(model) => updateProviderDraft(setConnectionDraft, { model })}
                    />
                  </SettingRow>
                  <SettingRow
                    label="访问密钥"
                    hint={
                      connectionSettings?.provider.hasApiKey
                        ? '已保存；留空不会覆盖现有密钥。'
                        : '用于连接模型服务，只保存在这台电脑上。'
                    }
                  >
                    <SecretTextField
                      ariaLabel="模型服务访问密钥"
                      value={connectionDraft.provider.apiKey ?? ''}
                      placeholder={connectionSettings?.provider.hasApiKey ? '留空以保留现有密钥' : '输入 Provider API Key'}
                      canReveal={Boolean(
                        connectionDraft.provider.apiKey || connectionSettings?.provider.hasApiKey,
                      )}
                      revealed={showApiKey}
                      revealing={revealingApiKey}
                      onToggleReveal={async () => {
                        if (showApiKey) {
                          setShowApiKey(false);
                          return;
                        }
                        if (
                          !connectionDraft.provider.apiKey &&
                          connectionSettings?.provider.hasApiKey
                        ) {
                          setRevealingApiKey(true);
                          setConnectionMessage(null);
                          try {
                            const apiKey = await window.whale.runtime.revealProviderApiKey();
                            if (!apiKey) throw new Error('runtime-settings.json 中没有找到已保存的 API Key');
                            updateProviderDraft(setConnectionDraft, {
                              apiKey,
                            });
                          } catch (error) {
                            setConnectionMessage(errorMessage(error));
                            return;
                          } finally {
                            setRevealingApiKey(false);
                          }
                        }
                        setShowApiKey(true);
                      }}
                      onChange={(apiKey) =>
                        updateProviderDraft(setConnectionDraft, { apiKey })
                      }
                    />
                  </SettingRow>
                  <div className="settings-provider-note">
                    <Check size={16} />
                    <span>
                      将使用模型 <strong>{connectionDraft.provider.model || '尚未配置'}</strong>，请求地址为
                      {' '}<code>{responsesEndpoint(connectionDraft.provider.baseUrl)}</code>。
                      {connectionDraft.provider.apiKey
                        ? ' 访问密钥已填写。'
                        : connectionSettings?.provider.hasApiKey
                          ? ' 已使用保存的访问密钥。'
                          : ' 尚未填写访问密钥。'}
                    </span>
                  </div>
                  <details className="settings-advanced">
                    <summary><ChevronDown size={13} /> 高级连接设置</summary>
                    <div className="settings-advanced-body">
                      <SettingRow label="Provider ID" hint={`${branding.name} 内部使用的服务标识。`}>
                        <TextField
                          ariaLabel="Provider ID"
                          value={connectionDraft.provider.id}
                          placeholder="custom"
                          onChange={(id) => updateProviderDraft(setConnectionDraft, { id })}
                        />
                      </SettingRow>
                      <SettingRow label="显示名称" hint={`显示在 ${branding.name} 的连接信息中。`}>
                        <TextField
                          ariaLabel="Provider 名称"
                          value={connectionDraft.provider.name}
                          placeholder="自定义模型服务"
                          onChange={(name) => updateProviderDraft(setConnectionDraft, { name })}
                        />
                      </SettingRow>
                    </div>
                  </details>
              </div>

              </div>
            </section>
            <section hidden={category !== 'model'}>
              <h3>回答方式</h3>
              <div className="settings-section-body">
              <p className="settings-section-intro">日常使用只需要选择回答时的思考强度。</p>
              {capabilities.supportsReasoning && (
                <SettingRow label="思考强度" hint="越深入通常越慢，也会使用更多额度。">
                  <SelectField
                    value={preferences.effort}
                    onChange={(effort) => void update({ effort })}
                    options={effortOptions}
                  />
                </SettingRow>
              )}
              <details className="settings-advanced">
                <summary><ChevronDown size={13} /> 高级模型能力</summary>
                <div className="settings-advanced-body">
              <SettingRow label="使用模型" hint="由上方 Provider 的模型名称决定。">
                <code>{connectionDraft.provider.model || '尚未配置'}</code>
              </SettingRow>
              <SettingRow label="能力概览" hint={`保存后写入 ${branding.name} 模型目录，决定运行时可用能力。`}>
                <div className="model-capability-summary">
                  <span>文本</span>
                  {capabilities.imageInput && <span>视觉</span>}
                  {capabilities.supportsReasoning && <span>推理</span>}
                  {capabilities.supportsReasoning && capabilities.supportsReasoningSummaries && (
                    <span>推理摘要</span>
                  )}
                  <span>{formatTokenCount(capabilities.contextWindow)} 上下文</span>
                </div>
              </SettingRow>
              <SettingRow label="上下文窗口" hint="模型可接收的最大 token 数；范围 1,024 到 10,000,000。">
                <NumberField
                  ariaLabel="模型上下文窗口"
                  value={capabilities.contextWindow}
                  min={1_024}
                  max={10_000_000}
                  onChange={(contextWindow) =>
                    updateCapabilityDraft(setConnectionDraft, { contextWindow })
                  }
                />
              </SettingRow>
              <SettingRow label="视觉输入" hint="允许把图片附件作为模型输入发送。">
                <SwitchField
                  ariaLabel="视觉输入"
                  enabled={capabilities.imageInput}
                  onChange={(imageInput) =>
                    updateCapabilityDraft(setConnectionDraft, { imageInput })
                  }
                />
              </SettingRow>
              <SettingRow label="推理能力" hint="关闭后模型目录不再声明任何推理档位。">
                <SwitchField
                  ariaLabel="推理能力"
                  enabled={capabilities.supportsReasoning}
                  onChange={(supportsReasoning) =>
                    updateCapabilityDraft(setConnectionDraft, { supportsReasoning })
                  }
                />
              </SettingRow>
              {capabilities.supportsReasoning && (
                <>
                  <SettingRow label="支持推理档位" hint="至少选择一个；这些档位会出现在会话设置中。">
                    <ReasoningEffortPicker
                      values={capabilities.reasoningEfforts}
                      onChange={(reasoningEfforts) => {
                        const currentDefault = capabilities.defaultReasoningEffort;
                        updateCapabilityDraft(setConnectionDraft, {
                          reasoningEfforts,
                          defaultReasoningEffort: reasoningEfforts.includes(currentDefault)
                            ? currentDefault
                            : reasoningEfforts[0],
                        });
                      }}
                    />
                  </SettingRow>
                  <SettingRow label="默认推理档位" hint="新会话首次加载该模型时使用。">
                    <SelectField
                      value={capabilities.defaultReasoningEffort}
                      onChange={(defaultReasoningEffort) =>
                        updateCapabilityDraft(setConnectionDraft, {
                          defaultReasoningEffort: defaultReasoningEffort as RuntimeReasoningEffort,
                        })
                      }
                      options={capabilities.reasoningEfforts.map((effort) => ({
                        value: effort,
                        label: reasoningEffortLabel(effort),
                      }))}
                    />
                  </SettingRow>
                  <SettingRow label="推理摘要" hint="允许 Responses API 接收 reasoning.summary 参数。">
                    <SwitchField
                      ariaLabel="推理摘要"
                      enabled={capabilities.supportsReasoningSummaries}
                      onChange={(supportsReasoningSummaries) =>
                        updateCapabilityDraft(setConnectionDraft, { supportsReasoningSummaries })
                      }
                    />
                  </SettingRow>
                </>
              )}
              <div className="connection-save-row model-capability-save-row">
                <div className="connection-message" role="status">{connectionMessage}</div>
                <button
                  className="button primary"
                  disabled={saving}
                  onClick={() => void saveConnection()}
                >
                  {saving ? <LoaderCircle className="spin" size={13} /> : <Save size={13} />}
                  保存能力并重连
                </button>
              </div>
                </div>
              </details>
              </div>
            </section>
            <section hidden={category !== 'permissions'}>
              <h3>执行权限</h3>
              <div className="settings-section-body">
              <SettingRow label="执行模式" hint="选择常用组合；下方仍可分别调整审批与文件权限。">
                <SelectField
                  value={executionPreset}
                  onChange={(preset) => {
                    const patch = executionPresetPreferences(preset as ExecutionPreset);
                    if (patch) void update(patch);
                  }}
                  options={executionPresetOptions}
                />
              </SettingRow>
              <SettingRow label="审批策略" hint="按需审批会自动拦截不受信命令；模型申请模式依赖模型主动请求。">
                <SelectField
                  value={preferences.approvalPolicy}
                  onChange={(approvalPolicy) =>
                    void update({ approvalPolicy: approvalPolicy as Preferences['approvalPolicy'] })
                  }
                  options={[
                    { value: 'untrusted', label: '按需审批（推荐）' },
                    { value: 'on-request', label: '仅模型申请时审批' },
                    { value: 'never', label: '从不询问' },
                  ]}
                />
              </SettingRow>
              <SettingRow label="文件与网络" hint="默认允许联网，并仅在当前项目内写入；项目外操作需要审批。">
                <SelectField
                  value={preferences.sandboxMode}
                  onChange={(sandboxMode) =>
                    void update({ sandboxMode: sandboxMode as Preferences['sandboxMode'] })
                  }
                  options={[
                    { value: 'workspace-write', label: '工作区写入' },
                    { value: 'read-only', label: '只读' },
                    { value: 'danger-full-access', label: '完全访问' },
                  ]}
                />
              </SettingRow>
              {(preferences.sandboxMode === 'danger-full-access' ||
                preferences.approvalPolicy === 'never') && (
                <div className="settings-warning">
                  <AlertTriangle size={16} />
                  <span>{executionPreset === 'yolo'
                    ? 'YOLO 已开启：命令、文件、网络与 MCP 工具可在不询问的情况下执行。'
                    : '当前是自定义的高权限或无审批组合；部分需要审批的工具可能被直接拒绝。'}</span>
                </div>
              )}
              </div>
            </section>
            <section hidden={category !== 'appearance'}>
              <h3>外观</h3>
              <div className="settings-section-body">
              <SettingRow label="应用名称" hint="修改侧栏、欢迎页、窗口标题和应用内文案中的显示名称。">
                <TextField
                  ariaLabel="应用名称"
                  value={brandingDraft.name}
                  placeholder="AI小鲸"
                  onChange={(name) => setBrandingDraft((draft) => ({ ...draft, name }))}
                />
              </SettingRow>
              <SettingRow label="应用图标" hint="支持 PNG、JPG 和 WebP；留空则使用内置蓝色小鲸。">
                <div className="branding-icon-editor">
                  <BrandMark size={42} />
                  <div className="branding-icon-actions">
                    <code title={brandingDraft.iconPath || '内置图标'}>
                      {brandingDraft.iconPath || '内置蓝色小鲸'}
                    </code>
                    <div>
                      <button
                        className="button secondary"
                        type="button"
                        onClick={async () => {
                          const iconPath = await window.whale.runtime.pickBrandIcon();
                          if (iconPath) setBrandingDraft((draft) => ({ ...draft, iconPath }));
                        }}
                      >
                        <Image size={13} /> 选择图片
                      </button>
                      <button
                        className="button secondary"
                        type="button"
                        disabled={!brandingDraft.iconPath}
                        onClick={() => setBrandingDraft((draft) => ({ ...draft, iconPath: '' }))}
                      >
                        <RotateCcw size={13} /> 恢复默认
                      </button>
                    </div>
                  </div>
                </div>
              </SettingRow>
              <div className="connection-save-row branding-save-row">
                <div className="connection-message" role="status">{brandingMessage}</div>
                <button
                  className="button primary"
                  disabled={savingBranding || !brandingDraft.name.trim()}
                  onClick={async () => {
                    setSavingBranding(true);
                    setBrandingMessage(null);
                    try {
                      const saved = await applyBrandingSettings(brandingDraft);
                      setBrandingDraft({ name: saved.name, iconPath: saved.iconPath });
                      setBrandingMessage('品牌设置已立即生效。');
                    } catch (error) {
                      setBrandingMessage(errorMessage(error));
                    } finally {
                      setSavingBranding(false);
                    }
                  }}
                >
                  {savingBranding ? <LoaderCircle className="spin" size={13} /> : <Save size={13} />}
                  保存品牌设置
                </button>
              </div>
              <SettingRow label="主题" hint="可跟随系统外观自动切换。">
                <SelectField
                  value={preferences.theme}
                  onChange={(theme) =>
                    void update({ theme: theme as Preferences['theme'] }, false)
                  }
                  options={[
                    { value: 'system', label: '跟随系统' },
                    { value: 'light', label: '浅色' },
                    { value: 'dark', label: '深色' },
                  ]}
                />
              </SettingRow>
              </div>
            </section>
            <section hidden={category !== 'account'}>
              <h3>账号服务</h3>
              <div className="settings-section-body">
              <SettingRow label="Casdoor 地址" hint="修改后会退出当前 Whale 账号，下次登录使用新的 OIDC 服务。">
                <TextField ariaLabel="Casdoor Issuer" value={authIssuer} placeholder="https://identity.example.com" onChange={setAuthIssuer} />
              </SettingRow>
              <div className="settings-actions">
                <button className="button primary" disabled={savingAuth || !authIssuer.trim()} onClick={() => {
                  setSavingAuth(true); setAuthMessage(null);
                  void window.whale.auth.configure({ issuer: authIssuer.trim() })
                    .then((settings) => { setAuthIssuer(settings.issuer); setAuthMessage('Casdoor 地址已保存，请重新登录。'); })
                    .catch((error) => setAuthMessage(errorMessage(error)))
                    .finally(() => setSavingAuth(false));
                }}>
                  {savingAuth ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />} 保存身份服务
                </button>
                {authMessage && <span>{authMessage}</span>}
              </div>
              </div>
            </section>
            <section hidden={category !== 'advanced'}>
              <h3>网络</h3>
              <div className="settings-section-body">
              <SettingRow label="代理方式" hint={`设置 ${branding.name} 连接模型和工具时使用的代理。`}>
                <SelectField
                  value={connectionDraft.proxy.mode}
                  onChange={(mode) =>
                    setConnectionDraft((draft) => ({
                      ...draft,
                      proxy: {
                        ...draft.proxy,
                        mode: mode as RuntimeConnectionSettingsInput['proxy']['mode'],
                      },
                    }))
                  }
                  options={[
                    { value: 'inherit', label: '继承启动环境' },
                    { value: 'custom', label: '自定义代理' },
                    { value: 'off', label: '不使用代理' },
                  ]}
                />
              </SettingRow>
              {connectionDraft.proxy.mode === 'custom' && (
                <>
                  <SettingRow label="代理地址" hint="支持 HTTP、HTTPS、SOCKS5；请勿在 URL 内嵌账号密码。">
                    <TextField
                      ariaLabel="Whale 代理地址"
                      value={connectionDraft.proxy.url}
                      placeholder="http://127.0.0.1:7890"
                      onChange={(url) =>
                        setConnectionDraft((draft) => ({
                          ...draft,
                          proxy: { ...draft.proxy, url },
                        }))
                      }
                    />
                  </SettingRow>
                  <SettingRow label="不走代理" hint="使用逗号分隔域名或 IP。">
                    <TextField
                      ariaLabel="代理绕过列表"
                      value={connectionDraft.proxy.noProxy}
                      placeholder="localhost,127.0.0.1,::1"
                      onChange={(noProxy) =>
                        setConnectionDraft((draft) => ({
                          ...draft,
                          proxy: { ...draft.proxy, noProxy },
                        }))
                      }
                    />
                  </SettingRow>
                </>
              )}
              </div>
            </section>
            <section hidden={category !== 'advanced'}>
              <h3>本地审计</h3>
              <div className="settings-section-body">
              <SettingRow label="操作记录" hint="身份、策略决策和关键事件只保存在本机，除非员工手动清除，否则永久保留。">
                <span>{auditCount === null ? '正在统计…' : `${auditCount} 条任务记录`}</span>
              </SettingRow>
              <div className="settings-actions">
                <button className="button secondary danger" onClick={async () => {
                  if (!await confirmAction('确认永久清除全部本地审计记录？此操作无法撤销。', { confirmLabel: '永久清除', danger: true })) return;
                  void window.whale.audit.clear()
                    .then(() => { setAuditCount(0); setAuditMessage('本地审计记录已清除。'); })
                    .catch((error) => setAuditMessage(errorMessage(error)));
                }}>清除审计记录</button>
                {auditMessage && <span>{auditMessage}</span>}
              </div>
              </div>
            </section>
            {(category === 'model' || category === 'advanced') && (
              <div className="connection-save-row">
                <div className="connection-message" role="status">{connectionMessage}</div>
                <button
                  className="button primary"
                  disabled={saving}
                  onClick={() => void saveConnection()}
                >
                  {saving ? <LoaderCircle className="spin" size={13} /> : <Save size={13} />}
                  保存并重连
                </button>
              </div>
            )}
          </div>
    </SettingsSurface>
  );
}

export type ExecutionPreset =
  | 'safe'
  | 'recommended'
  | 'model-request'
  | 'yolo'
  | 'custom';

export function executionPresetFor(
  preferences: Pick<Preferences, 'approvalPolicy' | 'sandboxMode'>,
): ExecutionPreset {
  if (preferences.approvalPolicy === 'untrusted' && preferences.sandboxMode === 'read-only') {
    return 'safe';
  }
  if (
    preferences.approvalPolicy === 'untrusted'
    && preferences.sandboxMode === 'workspace-write'
  ) {
    return 'recommended';
  }
  if (
    preferences.approvalPolicy === 'on-request'
    && preferences.sandboxMode === 'workspace-write'
  ) {
    return 'model-request';
  }
  if (
    preferences.approvalPolicy === 'never'
    && preferences.sandboxMode === 'danger-full-access'
  ) {
    return 'yolo';
  }
  return 'custom';
}

export function executionPresetPreferences(
  preset: ExecutionPreset,
): Pick<Preferences, 'approvalPolicy' | 'sandboxMode'> | null {
  switch (preset) {
    case 'safe':
      return { approvalPolicy: 'untrusted', sandboxMode: 'read-only' };
    case 'recommended':
      return { approvalPolicy: 'untrusted', sandboxMode: 'workspace-write' };
    case 'model-request':
      return { approvalPolicy: 'on-request', sandboxMode: 'workspace-write' };
    case 'yolo':
      return { approvalPolicy: 'never', sandboxMode: 'danger-full-access' };
    case 'custom':
      return null;
  }
}

function draftFromSettings(
  settings: ReturnType<typeof useAppStore.getState>['connectionSettings'],
): RuntimeConnectionSettingsInput {
  return {
    proxy: settings?.proxy ?? {
      mode: 'inherit',
      url: '',
      noProxy: 'localhost,127.0.0.1,::1',
    },
    provider: {
      mode: 'custom',
      id: settings?.provider.id ?? 'custom',
      name: settings?.provider.name ?? 'Custom Responses',
      baseUrl: settings?.provider.baseUrl ?? '',
      model: settings?.provider.model ?? '',
      capabilities: settings?.provider.capabilities ?? {
        contextWindow: 128_000,
        imageInput: false,
        supportsReasoning: true,
        reasoningEfforts: ['low', 'medium', 'high'],
        defaultReasoningEffort: 'medium',
        supportsReasoningSummaries: true,
      },
      apiKey: '',
    },
  };
}

function updateProviderDraft(
  setter: React.Dispatch<React.SetStateAction<RuntimeConnectionSettingsInput>>,
  patch: Partial<RuntimeConnectionSettingsInput['provider']>,
): void {
  setter((draft) => ({
    ...draft,
    provider: { ...draft.provider, ...patch },
  }));
}

function updateCapabilityDraft(
  setter: React.Dispatch<React.SetStateAction<RuntimeConnectionSettingsInput>>,
  patch: Partial<RuntimeConnectionSettingsInput['provider']['capabilities']>,
): void {
  setter((draft) => ({
    ...draft,
    provider: {
      ...draft.provider,
      capabilities: { ...draft.provider.capabilities, ...patch },
    },
  }));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function responsesEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  return normalized ? `${normalized}/responses` : '尚未配置 Base URL';
}

function reasoningEffortLabel(effort: string): string {
  switch (effort) {
    case 'none':
      return '关闭';
    case 'minimal':
      return '最小';
    case 'low':
      return '低';
    case 'medium':
      return '中';
    case 'high':
      return '高';
    case 'xhigh':
      return '超高';
    case 'max':
      return '最大';
    case 'ultra':
      return '极致';
    default:
      return effort;
  }
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000 && value % 1_000_000 === 0) return `${value / 1_000_000}M`;
  if (value >= 1_000 && value % 1_000 === 0) return `${value / 1_000}K`;
  return value.toLocaleString('zh-CN');
}

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{label}</strong>
        <small>{hint}</small>
      </div>
      {children}
    </div>
  );
}

function SelectField({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="native-select-field">
      <select
        className="select-trigger"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden="true" size={13} />
    </div>
  );
}

function NumberField({
  ariaLabel,
  value,
  min,
  max,
  onChange,
}: {
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      className="settings-input settings-number-input"
      aria-label={ariaLabel}
      type="number"
      value={draft}
      min={min}
      max={max}
      step={1_024}
      onChange={(event) => {
        setDraft(event.target.value);
        if (Number.isFinite(event.target.valueAsNumber)) onChange(event.target.valueAsNumber);
      }}
      onBlur={() => setDraft(String(value))}
    />
  );
}

function SwitchField({
  ariaLabel,
  enabled,
  onChange,
}: {
  ariaLabel: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={ariaLabel}
      aria-checked={enabled}
      className={`toggle-switch ${enabled ? 'enabled' : ''}`}
      onClick={() => onChange(!enabled)}
    >
      <span />
    </button>
  );
}

const REASONING_EFFORTS: RuntimeReasoningEffort[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
];

function ReasoningEffortPicker({
  values,
  onChange,
}: {
  values: RuntimeReasoningEffort[];
  onChange: (values: RuntimeReasoningEffort[]) => void;
}) {
  return (
    <div className="reasoning-effort-picker">
      {REASONING_EFFORTS.map((effort) => {
        const selected = values.includes(effort);
        return (
          <button
            key={effort}
            type="button"
            aria-pressed={selected}
            disabled={selected && values.length === 1}
            className={selected ? 'selected' : ''}
            onClick={() => onChange(
              selected ? values.filter((value) => value !== effort) : [...values, effort],
            )}
          >
            {reasoningEffortLabel(effort)}
          </button>
        );
      })}
    </div>
  );
}

function TextField({
  ariaLabel,
  type = 'text',
  value,
  placeholder,
  onChange,
}: {
  ariaLabel: string;
  type?: 'text' | 'password';
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      className="settings-input"
      aria-label={ariaLabel}
      type={type}
      value={value}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function SecretTextField({
  ariaLabel,
  value,
  placeholder,
  canReveal,
  revealed,
  revealing,
  onToggleReveal,
  onChange,
}: {
  ariaLabel: string;
  value: string;
  placeholder: string;
  canReveal: boolean;
  revealed: boolean;
  revealing: boolean;
  onToggleReveal: () => void | Promise<void>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="settings-secret-field">
      <input
        className="settings-input"
        aria-label={ariaLabel}
        type={revealed ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className="settings-secret-toggle"
        aria-label={revealed ? '隐藏 API Key' : '显示 API Key'}
        title={revealed ? '隐藏 API Key' : '显示 API Key'}
        disabled={revealing || !canReveal}
        onClick={() => void onToggleReveal()}
      >
        {revealing ? (
          <LoaderCircle className="spin" size={14} />
        ) : revealed ? (
          <EyeOff size={14} />
        ) : (
          <Eye size={14} />
        )}
      </button>
    </div>
  );
}
