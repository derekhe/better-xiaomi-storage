import { useState } from 'react';
import { ArrowRight, HardDrive, LogOut, RefreshCw } from 'lucide-react';
import type { AccountStatus } from '../types';

export function AccountPanel({ account, onChange }: { account: AccountStatus; onChange: (account: AccountStatus) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function perform(action: () => Promise<AccountStatus>) {
    setBusy(true); setError('');
    try { onChange(await action()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败，请重试'); }
    finally { setBusy(false); }
  }
  const signedIn = account.state === 'signed-in' || account.state === 'connecting';
  const waiting = account.state === 'signing-in' || account.state === 'connecting';
  return (
    <main className="account-screen">
      <div className="account-card">
        <div className="account-brand">拾光<span>把回忆放在眼前</span></div>
        <div className="account-symbol"><HardDrive size={30} /></div>
        <h1>{signedIn ? '选择你的存储设备' : '连接你的小米智能存储'}</h1>
        <p>{signedIn ? '选择一台设备，开始浏览照片和视频。' : '登录小米账号，直接打开相册，无需另装官方客户端。'}</p>
        {signedIn ? (
          <div className="device-choices">
            {account.devices.map(device => (
              <button key={device.id} disabled={busy || waiting} onClick={() => perform(() => window.smartStorage!.selectDevice(device.id))}>
                <HardDrive size={22} /><span>{device.name}<small>{device.online ? '点击连接' : '设备当前离线，可尝试连接'}</small></span><ArrowRight size={18} />
              </button>
            ))}
            {!account.devices.length ? <p>账号下尚未找到存储设备。请确认登录的是绑定设备的小米账号。</p> : null}
          </div>
        ) : (
          <button className="account-primary" disabled={busy || waiting || !account.runtimeAvailable} onClick={() => perform(() => window.smartStorage!.login())}>
            {waiting ? <RefreshCw className="account-spinner" size={18} /> : <ArrowRight size={18} />}
            {waiting ? '请在小米登录窗口中完成登录' : busy ? '正在打开登录窗口…' : '登录小米账号'}
          </button>
        )}
        {account.state === 'connecting' ? <p className="account-progress" role="status">正在连接设备并建立相册通道…</p> : null}
        {error || account.message ? <p className="account-error" role="alert">{error || account.message}</p> : null}
        {!account.runtimeAvailable ? <p className="account-error">当前安装缺少登录组件，请重新安装完整安装包。</p> : null}
        {signedIn || waiting ? <button className="account-secondary" disabled={busy} onClick={() => perform(() => window.smartStorage!.logout())}><LogOut size={15} />{waiting ? '取消登录 / 连接' : '退出账号，重新登录'}</button> : null}
        <div className="account-note">登录在小米窗口中完成。拾光只读取设备中的照片和视频。</div>
      </div>
    </main>
  );
}
