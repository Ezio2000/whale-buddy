import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, LogIn, LogOut, UserRound } from 'lucide-react';
import { useAppStore } from '../state/store';

export function AccountButton({ welcome = false }: { welcome?: boolean }) {
  const auth = useAppStore((state) => state.auth);
  const login = useAppStore((state) => state.login);
  const logout = useAppStore((state) => state.logout);
  const className = welcome ? 'account-button welcome-account-button' : 'account-button';

  if (auth.status !== 'logged-in') {
    const waiting = auth.status === 'waiting';
    return (
      <button
        className={className}
        disabled={waiting}
        title={auth.status === 'error' ? auth.message : undefined}
        onClick={() => void login()}
      >
        {waiting ? <span className="account-spinner" aria-hidden="true" /> : <LogIn size={15} />}
        <span>{waiting ? '等待浏览器登录…' : '登录 Whale'}</span>
      </button>
    );
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className={className} aria-label={`${auth.user.displayName}，账户菜单`}>
          <AccountAvatar name={auth.user.displayName} avatar={auth.user.avatar} />
          <span className="account-name">{auth.user.displayName}</span>
          <ChevronDown className="account-chevron" size={13} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu-content" sideOffset={5} align="start">
          <div className="account-menu-summary">
            <strong>{auth.user.displayName}</strong>
            <span>{auth.user.email ?? auth.user.username}</span>
          </div>
          <DropdownMenu.Separator className="menu-separator" />
          <DropdownMenu.Item className="menu-item" onSelect={() => void logout()}>
            <LogOut size={13} /> 退出登录
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function AccountAvatar({ name, avatar }: { name: string; avatar: string | null }) {
  if (avatar) return <img className="account-avatar" src={avatar} alt="" />;
  return (
    <span className="account-avatar account-avatar-fallback" aria-hidden="true">
      {name.trim().charAt(0).toUpperCase() || <UserRound size={14} />}
    </span>
  );
}
