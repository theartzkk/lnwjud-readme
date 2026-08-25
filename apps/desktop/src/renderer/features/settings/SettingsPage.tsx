import { useEffect, useState, type ReactElement } from 'react';
import type { DashboardSnapshot, DestructiveApprovalKey, DestructiveDeletePolicy, PermissionProfileName, UiLocale, UserSettings } from '@lnwjud/ipc-contracts';
import { createTranslator } from '../../i18n/index.js';
import { SettingSwitch } from './SettingSwitch.js';
import { UserConfigPanel, type UserConfigSection } from './UserConfigPanel.js';

interface SettingsPageProps {
  readonly locale: UiLocale;
  readonly dashboard: DashboardSnapshot;
  readonly onLocaleChange: (locale: UiLocale) => Promise<void>;
  readonly onPermissionProfileChange: (profile: PermissionProfileName) => Promise<void>;
  readonly onUnrestrictedChange: (enabled: boolean) => Promise<boolean>;
  readonly onDestructiveDeletePolicyChange: (policy: DestructiveDeletePolicy) => Promise<void>;
  readonly onStdioPolicyChange: (profile: PermissionProfileName, strictRoots: boolean, allowedRoots: readonly string[]) => Promise<boolean>;
  readonly onCreateBackup: () => Promise<void>;
  readonly onScheduleRestoreBackup: (backupId: string) => Promise<boolean>;
  readonly onSaveTunnelApiKey: (apiKey: string) => Promise<void>;
  readonly onSetTunnelClientPath: (clientPath: string) => Promise<void>;
  readonly onUserSettingsChange: (settings: UserSettings) => Promise<boolean>;
  readonly onChooseTunnelClientPath: () => Promise<string | null>;
  readonly onConfigureTunnelProfile: (tunnelId: string) => Promise<string>;
  readonly initialSection?: SettingsSection;
}

type SettingsSection = 'general' | 'security' | 'tools' | 'mcp' | 'tunnel' | 'backup';

export function SettingsPage(props: SettingsPageProps): ReactElement {
  const t = createTranslator(props.locale);
  const [activeSection, setActiveSection] = useState<SettingsSection>(props.initialSection ?? 'general');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [clientPath, setClientPath] = useState(props.dashboard.tunnel.clientPath ?? '');
  const [tunnelId, setTunnelId] = useState('');
  const [tunnelBusy, setTunnelBusy] = useState(false);
  const [tunnelMessage, setTunnelMessage] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [unrestrictedMessage, setUnrestrictedMessage] = useState<string | null>(null);
  const [stdioProfile, setStdioProfile] = useState<PermissionProfileName>(props.dashboard.stdioPermissionProfile);
  const [strictRoots, setStrictRoots] = useState(props.dashboard.stdioStrictRoots);
  const [allowedRootsText, setAllowedRootsText] = useState(props.dashboard.stdioAllowedRoots.join('\n'));
  const [stdioDirty, setStdioDirty] = useState(false);
  const [stdioMessage, setStdioMessage] = useState<string | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);

  const persistedRootsText = props.dashboard.stdioAllowedRoots.join('\n');
  useEffect(() => {
    if (stdioDirty) return;
    setStdioProfile(props.dashboard.stdioPermissionProfile);
    setStrictRoots(props.dashboard.stdioStrictRoots);
    setAllowedRootsText(persistedRootsText);
  }, [props.dashboard.stdioPermissionProfile, props.dashboard.stdioStrictRoots, persistedRootsText, stdioDirty]);

  useEffect(() => {
    setClientPath(props.dashboard.tunnel.clientPath ?? '');
  }, [props.dashboard.tunnel.clientPath]);

  function updateDestructivePolicy(next: DestructiveDeletePolicy): void {
    void props.onDestructiveDeletePolicyChange(next);
  }

  function setDestructiveApproval(key: DestructiveApprovalKey, enabled: boolean): void {
    const current = props.dashboard.destructiveDeletePolicy;
    updateDestructivePolicy({ ...current, approvals: { ...current.approvals, [key]: enabled } });
  }

  async function saveStdioPolicy(): Promise<void> {
    const roots = splitList(allowedRootsText);
    if (strictRoots && roots.length === 0) {
      setPolicyError(props.locale === 'th' ? 'Strict Roots ต้องกำหนด Allowed Root อย่างน้อย 1 path' : 'Strict Roots requires at least one Allowed Root path.');
      return;
    }
    setPolicyError(null);
    try {
      const restartRequired = await props.onStdioPolicyChange(stdioProfile, strictRoots, roots);
      setStdioDirty(false);
      setStdioMessage(restartRequired
        ? (props.locale === 'th' ? 'บันทึกแล้ว — Restart Tunnel เพื่อใช้ policy ใหม่กับ connection ปัจจุบัน' : 'Saved — restart Tunnel to apply the new policy to the current connection.')
        : t('settings.saved'));
    } catch (cause: unknown) {
      setPolicyError(cause instanceof Error ? cause.message : 'Could not save STDIO policy');
    }
  }

  async function browseTunnelClient(): Promise<void> {
    try {
      const selected = await props.onChooseTunnelClientPath();
      if (selected === null) return;
      setClientPath(selected);
      await props.onSetTunnelClientPath(selected);
      setSavedMessage(props.locale === 'th' ? 'บันทึก tunnel-client.exe แล้ว' : 'tunnel-client.exe saved.');
    } catch (cause: unknown) {
      setTunnelMessage(cause instanceof Error ? cause.message : 'Could not select tunnel-client.exe');
    }
  }

  async function configureTunnel(): Promise<void> {
    if (tunnelId.trim().length === 0) {
      setTunnelMessage(props.locale === 'th' ? 'กรุณาใส่ Tunnel ID' : 'Enter a Tunnel ID.');
      return;
    }
    setTunnelBusy(true);
    setTunnelMessage(null);
    try {
      const profilePath = await props.onConfigureTunnelProfile(tunnelId.trim());
      setTunnelMessage(props.locale === 'th' ? `ตั้งค่า Tunnel สำเร็จ: ${profilePath}` : `Tunnel configured: ${profilePath}`);
    } catch (cause: unknown) {
      setTunnelMessage(cause instanceof Error ? cause.message : (props.locale === 'th' ? 'ตั้งค่า Tunnel ไม่สำเร็จ' : 'Tunnel setup failed.'));
    } finally {
      setTunnelBusy(false);
    }
  }

  async function createBackupNow(): Promise<void> {
    setBackupBusy(true);
    setBackupError(null);
    try {
      await props.onCreateBackup();
      setBackupMessage(props.locale === 'th' ? 'สำรองข้อมูลเรียบร้อยแล้ว' : 'Backup completed.');
    } catch (cause: unknown) {
      setBackupError(cause instanceof Error ? cause.message : 'Backup failed');
    } finally {
      setBackupBusy(false);
    }
  }

  async function scheduleRestore(backupId: string): Promise<void> {
    setBackupBusy(true);
    setBackupError(null);
    try {
      const restartRequired = await props.onScheduleRestoreBackup(backupId);
      setBackupMessage(restartRequired
        ? (props.locale === 'th' ? 'เตรียม Restore แล้ว — ปิดและเปิด AWH ใหม่เพื่อใช้ข้อมูลชุดนี้' : 'Restore scheduled — restart AWH to apply it.')
        : (props.locale === 'th' ? 'เตรียม Restore แล้ว' : 'Restore scheduled.'));
    } catch (cause: unknown) {
      setBackupError(cause instanceof Error ? cause.message : 'Could not schedule restore');
    } finally {
      setBackupBusy(false);
    }
  }

  const navItems: readonly { id: SettingsSection; icon: string; title: string; description: string }[] = [
    { id: 'general', icon: '⌘', title: props.locale === 'th' ? 'ทั่วไป' : 'General', description: props.locale === 'th' ? 'ภาษา, Startup, Update' : 'Language, startup, updates' },
    { id: 'security', icon: '◇', title: props.locale === 'th' ? 'ความปลอดภัย' : 'Security', description: props.locale === 'th' ? 'สิทธิ์และ Workspace policy' : 'Permissions and workspace policy' },
    { id: 'tools', icon: '◎', title: props.locale === 'th' ? 'Tools' : 'Tools', description: props.locale === 'th' ? 'Codex, Timeout, Roots' : 'Codex, timeouts, roots' },
    { id: 'mcp', icon: '⬡', title: 'MCP & Extensions', description: props.locale === 'th' ? 'Servers, Skills, Allowlist' : 'Servers, skills, allowlist' },
    { id: 'tunnel', icon: '↗', title: 'Secure Tunnel', description: props.locale === 'th' ? 'API Key, Client, Reconnect' : 'API key, client, reconnect' },
    { id: 'backup', icon: '▣', title: props.locale === 'th' ? 'สำรองข้อมูล' : 'Backup', description: props.locale === 'th' ? 'Backup และ Restore' : 'Backup and restore' },
  ];

  const userConfigSection: UserConfigSection | null = activeSection === 'backup' ? null : activeSection;
  const currentNav = navItems.find((item) => item.id === activeSection) ?? navItems[0]!;

  return (
    <div className="page-content settings-page-v2">
      <div className="page-heading settings-page-heading">
        <div>
          <span className="settings-eyebrow">CONTROL CENTER</span>
          <h1>{t('settings.title')}</h1>
          <p className="page-subtitle">{props.locale === 'th' ? 'ตั้งค่าระบบจากหน้าเดียว โดยไม่ต้องแก้ไฟล์ config เอง' : 'Configure the system without editing configuration files manually.'}</p>
        </div>
        <div className="settings-health-chip"><span className="status-dot online" />{props.locale === 'th' ? 'Local settings' : 'Local settings'}</div>
      </div>

      <div className="settings-shell-v2">
        <aside className="settings-subnav" aria-label="Settings sections">
          {navItems.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`settings-nav-item ${activeSection === item.id ? 'is-active' : ''}`}
              aria-current={activeSection === item.id ? 'page' : undefined}
              onClick={() => setActiveSection(item.id)}
            >
              <span className="settings-nav-icon" aria-hidden="true">{item.icon}</span>
              <span className="settings-nav-copy"><strong>{item.title}</strong><small>{item.description}</small></span>
              <span className="settings-nav-chevron" aria-hidden="true">›</span>
            </button>
          ))}
        </aside>

        <div className="settings-content-v2">
          <header className="settings-section-header">
            <span className="settings-section-kicker">SETTINGS / {currentNav.title.toUpperCase()}</span>
            <h2>{currentNav.title}</h2>
            <p>{currentNav.description}</p>
          </header>

          {activeSection === 'general' ? (
            <section className="panel settings-card settings-card-polished" aria-label={t('settings.generalTitle')}>
              <SettingsCardHeading icon="A" title={t('settings.generalTitle')} subtitle={props.locale === 'th' ? 'ภาษา UI, Tray และข้อความระบบ' : 'UI, tray, and system-message language'} badge={props.locale.toUpperCase()} />
              <div className="setting-field max-field-width">
                <label className="field-label" htmlFor="locale-select">{t('settings.locale')}</label>
                <select id="locale-select" className="settings-select" value={props.locale} onChange={(event) => { void props.onLocaleChange(event.target.value as UiLocale); }}>
                  <option value="th">🇹🇭 {t('language.th')}</option>
                  <option value="en">🇺🇸 {t('language.en')}</option>
                </select>
              </div>
              <p className="hint">{props.locale === 'th' ? 'เปลี่ยนภาษาหน้าจอ Tray และข้อความระบบทันที' : 'Changes screen, tray, and system-message language immediately.'}</p>
            </section>
          ) : null}

          {activeSection === 'security' ? (
            <>
              <section className="panel settings-card settings-card-polished" aria-label={t('settings.securityTitle')}>
                <SettingsCardHeading icon="◇" title={t('settings.securityTitle')} subtitle={profileHint(props.locale, props.dashboard.permissionProfile)} badge={props.dashboard.permissionProfile.toUpperCase()} />
                <div className="setting-field max-field-width">
                  <label className="field-label" htmlFor="permission-profile">{t('settings.permissions')}</label>
                  <select id="permission-profile" aria-label="Permission profile" className="settings-select" value={props.dashboard.permissionProfile} onChange={(event) => { void props.onPermissionProfileChange(event.target.value as PermissionProfileName); }}>
                    <option value="safe">🛡️ {t('permission.safe')}</option>
                    <option value="balanced">⚖️ {t('permission.balanced')}</option>
                    <option value="full">⚡ {t('permission.full')}</option>
                    <option value="custom">🔧 {t('permission.custom')}</option>
                  </select>
                </div>
              </section>

              <section className="panel settings-card settings-card-polished" aria-label={t('settings.unrestricted')}>
                <SettingsCardHeading icon="⚡" title={t('settings.unrestricted')} subtitle={props.locale === 'th' ? 'ปลดข้อจำกัด machine roots สำหรับงานที่ต้องการสิทธิ์เต็ม' : 'Remove machine-root restrictions for full-power workflows'} badge={props.dashboard.unrestricted ? 'ON' : 'OFF'} />
                <SettingSwitch checked={props.dashboard.unrestricted} label={props.locale === 'th' ? 'Unrestricted mode' : 'Unrestricted mode'} description={t('settings.unrestrictedHint')} onChange={(enabled) => { void props.onUnrestrictedChange(enabled).then((restartRequired) => setUnrestrictedMessage(restartRequired ? t('settings.restartRequired') : null)); }} />
                {unrestrictedMessage === null ? null : <div className="alert-box-warning" role="status">⚠️ {unrestrictedMessage}</div>}
              </section>

              <section className="panel settings-card settings-card-polished" aria-label="AI destructive action policy">
                <SettingsCardHeading
                  icon="⌫"
                  title={props.locale === 'th' ? 'สิทธิ์ AI ลบ / ทิ้งข้อมูล' : 'AI Destructive Actions'}
                  subtitle={props.locale === 'th' ? 'Auto-approve แยกตามคำสั่ง — จำกัดเฉพาะ Active Project' : 'Per-command auto-approval — always scoped to the Active Project'}
                  badge={Object.values(props.dashboard.destructiveDeletePolicy.approvals).some(Boolean) ? 'CUSTOM' : 'ASK'}
                />
                <div className="alert-box-warning" role="note">
                  ⚠️ {props.locale === 'th'
                    ? 'เปิดสวิตช์แล้ว AI จะไม่ถามซ้ำเฉพาะคำสั่งนั้น เมื่อพิสูจน์ได้ว่าเป้าหมายอยู่ใน Active Project เท่านั้น ถ้า path คลุมเครือ, ออกนอกโปรเจกต์ หรือ Active Project เป็นทั้งไดรฟ์ ระบบจะกลับไปขออนุมัติ'
                    : 'Enabled actions skip per-call approval only when every target is proven inside the Active Project. Ambiguous/out-of-project paths and whole-drive project roots fall back to approval.'}
                </div>
                <div className="setting-grid two-col align-center">
                  <SettingSwitch
                    checked={props.dashboard.destructiveDeletePolicy.protectCriticalFiles}
                    label={props.locale === 'th' ? 'Protected Critical Files' : 'Protected Critical Files'}
                    description={props.locale === 'th' ? 'บังคับถามก่อนลบ .env, .git, key/cert, database, manifest/lockfile สำคัญ' : 'Always ask before deleting .env, .git, keys/certs, databases, and critical manifests/lockfiles'}
                    onChange={(enabled) => updateDestructivePolicy({ ...props.dashboard.destructiveDeletePolicy, protectCriticalFiles: enabled })}
                  />
                  <SettingSwitch
                    checked={props.dashboard.destructiveDeletePolicy.recoverableDelete}
                    label={props.locale === 'th' ? 'Recoverable delete_file' : 'Recoverable delete_file'}
                    description={props.locale === 'th' ? 'delete_file ย้ายของที่ลบเข้า Recovery Trash และสร้าง checkpoint เมื่อทำได้' : 'delete_file moves targets to Recovery Trash and checkpoints files when possible'}
                    onChange={(enabled) => updateDestructivePolicy({ ...props.dashboard.destructiveDeletePolicy, recoverableDelete: enabled })}
                  />
                </div>
                <div className="settings-mini-heading"><strong>{props.locale === 'th' ? 'คำสั่งที่อนุญาตให้ AI ทำเอง' : 'Auto-approved command families'}</strong><span>Active Project only</span></div>
                <div className="setting-grid two-col">
                  {destructiveApprovalRows(props.locale).map((row) => (
                    <SettingSwitch
                      key={row.key}
                      checked={props.dashboard.destructiveDeletePolicy.approvals[row.key]}
                      label={row.label}
                      description={row.description}
                      onChange={(enabled) => setDestructiveApproval(row.key, enabled)}
                    />
                  ))}
                </div>
                <p className="hint">
                  {props.locale === 'th'
                    ? 'PowerShell/cmd/bash แบบ command string, Node/Python script ที่ลบไฟล์, robocopy /MIR /PURGE, force-push/ลบ remote history และ opaque UI actions ยังต้องขออนุมัติเสมอ เพราะพิสูจน์ target ล่วงหน้าไม่ได้อย่างปลอดภัย'
                    : 'Opaque PowerShell/cmd/bash command strings, Node/Python delete scripts, robocopy /MIR or /PURGE, remote-history rewrites, and opaque UI actions still always require approval.'}
                </p>
              </section>

              <section className="panel settings-card settings-card-polished" aria-label="STDIO security policy">
                <SettingsCardHeading icon="▦" title="STDIO / Tunnel Security Policy" subtitle={props.locale === 'th' ? 'Policy สำหรับ connection ที่เข้าผ่าน stdio และ Secure Tunnel' : 'Policy for stdio and Secure Tunnel connections'} badge={props.dashboard.stdioPermissionProfile.toUpperCase()} />
                <div className="setting-grid two-col align-center">
                  <div className="setting-field">
                    <label className="field-label" htmlFor="stdio-profile">STDIO Permission Profile</label>
                    <select id="stdio-profile" className="settings-select" value={stdioProfile} onChange={(event) => { setStdioProfile(event.target.value as PermissionProfileName); setStdioDirty(true); }}>
                      <option value="safe">Safe</option><option value="balanced">Balanced</option><option value="full">Full</option><option value="custom">Custom</option>
                    </select>
                  </div>
                  <SettingSwitch checked={strictRoots} label="Strict Workspace Roots" description={props.locale === 'th' ? 'บล็อก absolute path นอก Allowed Roots แบบ fail-closed' : 'Reject absolute paths outside Allowed Roots fail-closed'} onChange={(enabled) => { setStrictRoots(enabled); setStdioDirty(true); }} />
                </div>
                <div className="setting-field">
                  <label className="field-label" htmlFor="stdio-roots">{props.locale === 'th' ? 'Allowed Roots — หนึ่ง path ต่อบรรทัด' : 'Allowed Roots — one path per line'}</label>
                  <textarea id="stdio-roots" className="settings-textarea" rows={5} value={allowedRootsText} placeholder={'E:\\Projects\\MyApp\nD:\\Shared\\Source'} onChange={(event) => { setAllowedRootsText(event.target.value); setStdioDirty(true); }} />
                </div>
                <div className="inline-actions"><button type="button" className="btn-save-gold" disabled={!stdioDirty} onClick={() => { void saveStdioPolicy(); }}>{props.locale === 'th' ? 'บันทึก STDIO Policy' : 'Save STDIO Policy'}</button></div>
                {policyError === null ? null : <div className="alert-box-warning" role="alert">⚠️ {policyError}</div>}
                {stdioMessage === null ? null : <div className="toast-success-banner" role="status">✓ {stdioMessage}</div>}
              </section>
            </>
          ) : null}

          <UserConfigPanel locale={props.locale} settings={props.dashboard.settings} section={userConfigSection} onSave={props.onUserSettingsChange} />

          {activeSection === 'tunnel' ? (
            <section className="panel settings-card settings-card-polished" aria-label={t('settings.tunnelTitle')}>
              <SettingsCardHeading icon="↗" title={t('settings.tunnelTitle')} subtitle={props.locale === 'th' ? 'Credential, tunnel-client และ Setup Wizard' : 'Credentials, tunnel-client, and setup wizard'} badge={props.dashboard.tunnel.profileExists ? (props.locale === 'th' ? 'พร้อมใช้งาน' : 'READY') : (props.locale === 'th' ? 'ต้องตั้งค่า' : 'SETUP')} />
              <div className="setting-grid two-col">
                <div className="setting-field">
                  <label className="field-label" htmlFor="tunnel-key">{t('settings.tunnelKey')}</label>
                  <div className="form-row"><div className="password-input-wrapper"><input id="tunnel-key" type={showApiKey ? 'text' : 'password'} placeholder={props.dashboard.tunnel.hasApiKey ? '••••••••••••••••' : 'sk-...'} value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" /><button type="button" className="toggle-pw-btn" onClick={() => setShowApiKey((value) => !value)}>{showApiKey ? 'Hide' : 'Show'}</button></div><button type="button" className="btn-save-gold" onClick={() => { void props.onSaveTunnelApiKey(apiKey).then(() => { setApiKey(''); setSavedMessage(t('settings.saved')); }); }}>{t('settings.saveKey')}</button></div>
                  <p className="hint">{props.dashboard.tunnel.hasApiKey ? 'Protected with Windows DPAPI' : t('tunnel.needKey')}</p>
                </div>
                <div className="setting-field">
                  <label className="field-label" htmlFor="tunnel-client-path">{t('settings.clientPath')}</label>
                  <div className="form-row"><input id="tunnel-client-path" placeholder="C:\tools\tunnel-client.exe" value={clientPath} onChange={(event) => setClientPath(event.target.value)} /><button type="button" onClick={() => { void browseTunnelClient(); }}>{props.locale === 'th' ? 'เลือกไฟล์…' : 'Browse…'}</button><button type="button" className="btn-save-gold" onClick={() => { void props.onSetTunnelClientPath(clientPath).then(() => setSavedMessage(t('settings.saved'))); }}>{t('settings.savePath')}</button></div>
                </div>
              </div>
              <div className="tunnel-setup-box">
                <div className="settings-mini-heading"><strong>Setup Wizard</strong><span>{props.locale === 'th' ? 'ไม่ต้องเปิด PowerShell init เอง' : 'No manual PowerShell init'}</span></div>
                <label className="field-label" htmlFor="tunnel-id">OpenAI Tunnel ID</label>
                <div className="form-row"><input id="tunnel-id" placeholder="tunnel_0123456789abcdef..." value={tunnelId} onChange={(event) => setTunnelId(event.target.value)} /><button type="button" className="btn-save-gold" disabled={tunnelBusy} onClick={() => { void configureTunnel(); }}>{tunnelBusy ? (props.locale === 'th' ? 'กำลังตั้งค่า…' : 'Configuring…') : (props.locale === 'th' ? 'Configure Tunnel' : 'Configure Tunnel')}</button></div>
              </div>
              {savedMessage === null ? null : <div className="toast-success-banner" role="status">✓ {savedMessage}</div>}
              {tunnelMessage === null ? null : <div className="alert-box-warning" role="status">{tunnelMessage}</div>}
            </section>
          ) : null}

          {activeSection === 'backup' ? (
            <section className="panel settings-card settings-card-polished" aria-label="Backup and restore">
              <SettingsCardHeading icon="▣" title={props.locale === 'th' ? 'สำรองและกู้คืนข้อมูล' : 'Backup & Restore'} subtitle="SQLite consistent snapshots" action={<button type="button" className="btn-save-gold" disabled={backupBusy} onClick={() => { void createBackupNow(); }}>{backupBusy ? (props.locale === 'th' ? 'กำลังทำงาน…' : 'Working…') : (props.locale === 'th' ? 'Backup ตอนนี้' : 'Backup Now')}</button>} />
              {props.dashboard.backups.length === 0 ? <div className="empty-setting-state">{props.locale === 'th' ? 'ยังไม่มี Backup' : 'No backups yet'}</div> : (
                <div className="backup-list settings-backup-list">{props.dashboard.backups.slice(0, 5).map((backup) => (
                  <div key={backup.id} className="backup-item"><div><strong>{new Date(backup.createdAt).toLocaleString(props.locale === 'th' ? 'th-TH' : 'en-US')}</strong><p className="hint">{backup.reason} · {formatBytes(backup.sizeBytes)}</p></div><button type="button" disabled={backupBusy || props.dashboard.tunnel.state === 'running' || props.dashboard.mcp.running} onClick={() => { void scheduleRestore(backup.id); }}>{props.locale === 'th' ? 'Restore ชุดนี้' : 'Restore'}</button></div>
                ))}</div>
              )}
              {(props.dashboard.tunnel.state === 'running' || props.dashboard.mcp.running) ? <div className="alert-box-warning">⚠️ {props.locale === 'th' ? 'หยุด Tunnel และ Local MCP ก่อน Restore' : 'Stop Tunnel and local MCP before scheduling a restore.'}</div> : null}
              {backupError === null ? null : <div className="alert-box-warning" role="alert">⚠️ {backupError}</div>}
              {backupMessage === null ? null : <div className="toast-success-banner" role="status">✓ {backupMessage}</div>}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SettingsCardHeading({ icon, title, subtitle, badge, action }: { readonly icon: string; readonly title: string; readonly subtitle: string; readonly badge?: string; readonly action?: ReactElement }): ReactElement {
  return (
    <div className="section-heading settings-card-heading">
      <div className="settings-heading-copy"><span className="settings-card-icon" aria-hidden="true">{icon}</span><div><h2 className="settings-card-title">{title}</h2><span className="page-subtitle">{subtitle}</span></div></div>
      {action ?? (badge === undefined ? null : <span className="pill-badge gold">{badge}</span>)}
    </div>
  );
}

function destructiveApprovalRows(locale: UiLocale): readonly { readonly key: DestructiveApprovalKey; readonly label: string; readonly description: string }[] {
  if (locale === 'th') return [
    { key: 'delete_file', label: 'delete_file', description: 'ลบไฟล์/โฟลเดอร์ว่างแบบ scoped; ใช้ Recovery Trash ได้' },
    { key: 'git_rm', label: 'git rm', description: 'ลบ tracked path ที่พิสูจน์ว่าอยู่ใน Active Project' },
    { key: 'git_clean', label: 'git clean', description: 'ลบ untracked files; เมื่อ Critical Protection เปิด ต้องมี pathspec ชัดเจน' },
    { key: 'git_reset_restore', label: 'git reset / restore', description: 'อนุญาตทิ้ง working-tree/index changes ภายใน repo ที่ active' },
    { key: 'shell_rm_unlink', label: 'rm / unlink', description: 'เฉพาะ executable ตรง + argv path ภายใน Active Project' },
    { key: 'shell_rmdir', label: 'rmdir / rd', description: 'เฉพาะ directory target ภายใน Active Project' },
    { key: 'shell_del_erase', label: 'del / erase', description: 'Windows direct delete executable ภายใน Active Project' },
    { key: 'wsl_rm_unlink', label: 'WSL rm / unlink', description: 'เฉพาะ relative path ที่ผูกกับ Active Project' },
    { key: 'wsl_rmdir', label: 'WSL rmdir', description: 'เฉพาะ relative directory path ที่ผูกกับ Active Project' },
  ];
  return [
    { key: 'delete_file', label: 'delete_file', description: 'Scoped file/empty-directory deletion; supports Recovery Trash' },
    { key: 'git_rm', label: 'git rm', description: 'Tracked paths proven inside the Active Project' },
    { key: 'git_clean', label: 'git clean', description: 'Untracked deletion; critical protection requires explicit pathspecs' },
    { key: 'git_reset_restore', label: 'git reset / restore', description: 'Discard working-tree/index changes in the active repository' },
    { key: 'shell_rm_unlink', label: 'rm / unlink', description: 'Direct executable + argv paths inside the Active Project only' },
    { key: 'shell_rmdir', label: 'rmdir / rd', description: 'Directory targets inside the Active Project only' },
    { key: 'shell_del_erase', label: 'del / erase', description: 'Direct Windows delete executable inside the Active Project' },
    { key: 'wsl_rm_unlink', label: 'WSL rm / unlink', description: 'Relative paths anchored to the Active Project only' },
    { key: 'wsl_rmdir', label: 'WSL rmdir', description: 'Relative directory paths anchored to the Active Project only' },
  ];
}

function splitList(value: string): readonly string[] {
  const seen = new Set<string>();
  return value.split(/[;\r\n]+/).map((entry) => entry.trim()).filter((entry) => { if (entry.length === 0) return false; const key = entry.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
}

function profileHint(locale: UiLocale, profile: PermissionProfileName): string {
  const th = { safe: 'ปลอดภัยสูงสุด: งานเขียนและรันคำสั่งต้องขออนุญาต', balanced: 'สมดุล: งานทั่วไปใน workspace ทำได้คล่องขึ้น', full: 'เต็มสิทธิ์ตาม policy ที่ยังคงบล็อก operation อันตรายระดับระบบ', custom: 'ใช้กฎ READ / WRITE / EXECUTE / DANGEROUS และ executable ที่กำหนดเอง' } as const;
  const en = { safe: 'Maximum safety: writes and execution require approval.', balanced: 'Balanced: common workspace work is less restrictive.', full: 'Full access within policy; machine-destructive operations remain blocked.', custom: 'Uses your READ / WRITE / EXECUTE / DANGEROUS rules and custom executables.' } as const;
  return (locale === 'th' ? th : en)[profile];
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0 B';
  if (value < 1024) return value + ' B';
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
  return (value / (1024 * 1024)).toFixed(1) + ' MB';
}
