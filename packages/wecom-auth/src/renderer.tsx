import * as Dialog from '@radix-ui/react-dialog';
import { LogOut, QrCode, RefreshCcw, UserRoundCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { WecomAuthStatus, WecomIdentity } from './types';
import './styles.css';

export function WecomIdentityButton() {
  const [status, setStatus] = useState<WecomAuthStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const api = window.whaleWecom;
    if (!api) {
      setStatus({ configured: false, identity: null });
      return;
    }
    void api.status().then(setStatus).catch(() => setStatus({
      configured: false,
      identity: null,
    }));
  }, []);

  if (!status?.configured) return null;
  const identity = status.identity;

  const login = async () => {
    setBusy(true);
    setError('');
    try {
      const nextIdentity = await window.whaleWecom.login();
      setStatus({ configured: true, identity: nextIdentity });
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : String(loginError));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    setError('');
    try {
      setStatus(await window.whaleWecom.logout());
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : String(logoutError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button title={identity ? `企业微信身份：${identity.name}` : '企业微信扫码登录'}>
          {identity ? <UserRoundCheck size={15} /> : <QrCode size={15} />}
          <span>{identity?.name || '企业微信登录'}</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="wecom-auth-overlay" />
        <Dialog.Content className="wecom-auth-dialog">
          <header>
            <div>
              <Dialog.Title>企业微信身份</Dialog.Title>
              <Dialog.Description>扫码后仅获取当前企业成员的基本身份信息。</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="wecom-auth-icon-button" aria-label="关闭">
                <X size={16} />
              </button>
            </Dialog.Close>
          </header>

          {identity ? <IdentityDetails identity={identity} /> : (
            <div className="wecom-auth-empty">
              <QrCode size={36} />
              <strong>尚未获取企业身份</strong>
              <span>点击下方按钮后，会打开独立的企业微信二维码窗口。</span>
            </div>
          )}

          {error && <p className="wecom-auth-error" role="alert">{error}</p>}

          <footer>
            <button className="wecom-auth-primary" disabled={busy} onClick={() => void login()}>
              {identity ? <RefreshCcw size={15} /> : <QrCode size={15} />}
              {busy ? '等待扫码…' : identity ? '重新扫码' : '开始扫码'}
            </button>
            {identity && (
              <button disabled={busy} onClick={() => void logout()}>
                <LogOut size={15} /> 清除身份
              </button>
            )}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function IdentityDetails({ identity }: { identity: WecomIdentity }) {
  return (
    <div className="wecom-auth-identity">
      <div className="wecom-auth-profile">
        {identity.avatar ? <img src={identity.avatar} alt="" /> : (
          <span className="wecom-auth-avatar"><UserRoundCheck size={24} /></span>
        )}
        <div>
          <strong>{identity.name}</strong>
          <span>{identity.userId}</span>
        </div>
      </div>
      <dl>
        <div><dt>企业 ID</dt><dd>{identity.corpId}</dd></div>
        {identity.email && <div><dt>邮箱</dt><dd>{identity.email}</dd></div>}
        {identity.mobile && <div><dt>手机号</dt><dd>{identity.mobile}</dd></div>}
        {identity.departmentIds.length > 0 && (
          <div><dt>部门 ID</dt><dd>{identity.departmentIds.join(', ')}</dd></div>
        )}
        <div><dt>认证时间</dt><dd>{formatTime(identity.authenticatedAt)}</dd></div>
      </dl>
    </div>
  );
}

function formatTime(value: string): string {
  if (!value) return '未知';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
}
