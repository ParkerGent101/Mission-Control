/* Mission Control — Settings Panel */
const { useState: useST, useEffect: useEffectST } = React;

const THEMES = [
  { id: "amber",  name: "Amber",   accent: "#e0a857", accent2: "#6ed3b6" },
  { id: "teal",   name: "Teal",    accent: "#5ec4a8", accent2: "#b69cf0" },
  { id: "rose",   name: "Rose",    accent: "#e07a5f", accent2: "#5ec4a8" },
  { id: "violet", name: "Violet",  accent: "#b69cf0", accent2: "#8fb3e0" },
  { id: "ocean",  name: "Ocean",   accent: "#8fb3e0", accent2: "#5ec4a8" },
  { id: "steel",  name: "Steel",   accent: "#c4c8cf", accent2: "#8fb3e0" },
];

const ST_SECTIONS = [
  { id: "account",      icon: "circle",     label: "Account" },
  { id: "appearance",   icon: "settings",   label: "Appearance" },
  { id: "modules",      icon: "home",       label: "Modules" },
  { id: "integrations", icon: "external",   label: "Integrations" },
  { id: "data",         icon: "file",       label: "Data" },
  { id: "about",        icon: "sparkles",   label: "About" },
];

const MODULE_LIST = [
  { id: "agenda",   label: "Today / Agenda",   icon: "calendar" },
  { id: "finance",  label: "Finance",           icon: "wallet" },
  { id: "band",     label: "Band",              icon: "music" },
  { id: "health",   label: "Health & Fitness",  icon: "heart" },
  { id: "work",     label: "Work",              icon: "briefcase" },
  { id: "reading",  label: "Reading",           icon: "book" },
  { id: "holidays", label: "Holidays / Travel", icon: "plane" },
  { id: "journal",  label: "Journal",           icon: "feather" },
  { id: "activity", label: "Activity Log",      icon: "clock" },
  { id: "calendar", label: "Calendar",          icon: "calendar" },
];

const FieldRow = ({ label, desc, children, style }) => (
  <div className="st-field" style={style}>
    <div className="st-field-info">
      <div className="st-field-label">{label}</div>
      {desc && <div className="st-field-desc">{desc}</div>}
    </div>
    <div className="st-field-ctrl">{children}</div>
  </div>
);

const Toggle = ({ value, onChange }) => (
  <button className={"st-toggle" + (value ? " on" : "")} onClick={() => onChange(!value)}>
    <span className="st-toggle-knob" />
  </button>
);

const SectionHead = ({ children, style }) => (
  <div className="st-section-head" style={style}>{children}</div>
);

const SegButtons = ({ options, value, onChange }) => (
  <div style={{ display: 'flex', gap: 4 }}>
    {options.map(v => (
      <button key={v} className={"btn" + (value === v ? " primary" : "")}
        onClick={() => onChange(v)}
        style={{ textTransform: 'capitalize', fontSize: 11.5, padding: '4px 10px' }}>
        {v}
      </button>
    ))}
  </div>
);

const SettingsPanel = ({ open, onClose, tweaks, setTweak, userName, setUserName, onReEnroll, onLogout }) => {
  const [section, setSection] = useST("account");
  const [profileName, setProfileName] = useST(userName || "");
  const [curPw, setCurPw] = useST("");
  const [newPw, setNewPw] = useST("");
  const [pwMsg, setPwMsg] = useST(null);
  const [nameMsg, setNameMsg] = useST(null);
  const [integStatus, setIntegStatus] = useST(null);
  const [calConnecting, setCalConnecting] = useST(false);
  const [resetConfirm, setResetConfirm] = useST(false);
  const [driveStatus, setDriveStatus] = useST(null);
  const [sheetFinance, setSheetFinance] = useST('');
  const [sheetContacts, setSheetContacts] = useST('');
  const [driveSyncing, setDriveSyncing] = useST(null);
  const [driveMsg, setDriveMsg] = useST({});

  useEffectST(() => {
    if (!open) return;
    setProfileName(userName || "");
    setCurPw(""); setNewPw(""); setPwMsg(null); setNameMsg(null);
    setResetConfirm(false);
  }, [open, userName]);

  useEffectST(() => {
    if (section !== "integrations") return;
    Promise.all([
      fetch('/api/calendar/events').then(r => r.json()).catch(() => ({ error: "setup_required" })),
      fetch('/api/drive/status').then(r => r.json()).catch(() => ({ connected: false })),
    ]).then(([cal, drive]) => {
      setIntegStatus({
        calendar: !cal.error,
        calSetup: cal.error !== "setup_required",
        drive: !!drive.connected,
        driveSetup: !drive.setup_required,
      });
      if (drive.sheet_finance) setSheetFinance(drive.sheet_finance);
      if (drive.sheet_contacts) setSheetContacts(drive.sheet_contacts);
    });
  }, [section]);

  if (!open) return null;

  const saveName = async () => {
    const trimmed = profileName.trim();
    if (!trimmed) return;
    await fetch('/api/user/profile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed })
    });
    const first = trimmed.split(' ')[0];
    setUserName(first);
    localStorage.setItem('mc_name', first);
    setNameMsg({ ok: true, text: "Saved" });
    setTimeout(() => setNameMsg(null), 2000);
  };

  const changePassword = async () => {
    if (!curPw || !newPw) return;
    const r = await fetch('/api/user/password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current: curPw, new: newPw })
    });
    const d = await r.json();
    if (d.ok) { setPwMsg({ ok: true, text: "Password updated" }); setCurPw(""); setNewPw(""); }
    else setPwMsg({ ok: false, text: d.error || "Incorrect password" });
    setTimeout(() => setPwMsg(null), 3000);
  };

  const connectCalendar = async () => {
    setCalConnecting(true);
    const r = await fetch('/api/calendar/auth');
    const d = await r.json();
    if (d.auth_url) window.location.href = d.auth_url;
    else { window.__toast?.(d.error || 'Calendar credentials not found', 'error'); setCalConnecting(false); }
  };

  const connectDrive = async () => {
    const r = await fetch('/api/drive/auth');
    const d = await r.json();
    if (d.auth_url) window.location.href = d.auth_url;
    else window.__toast?.(d.error || 'Drive credentials not found', 'error');
  };

  const saveSheets = async () => {
    const r = await fetch('/api/drive/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet_finance: sheetFinance.trim(), sheet_contacts: sheetContacts.trim() }),
    });
    const d = await r.json();
    if (d.ok) window.__toast?.('Sheet IDs saved', 'success');
    else window.__toast?.(d.error || 'Save failed', 'error');
  };

  const syncDrive = async (type) => {
    setDriveSyncing(type);
    const r = await fetch(`/api/drive/sync/${type}`, { method: 'POST' });
    const d = await r.json();
    setDriveSyncing(null);
    const msg = d.ok ? `Synced ${d.count != null ? d.count + ' rows' : ''}`.trim() : (d.error || 'Sync failed');
    setDriveMsg(prev => ({ ...prev, [type]: msg }));
    setTimeout(() => setDriveMsg(prev => ({ ...prev, [type]: null })), 4000);
  };

  const pushDrive = async (type) => {
    const key = `push-${type}`;
    setDriveSyncing(key);
    const r = await fetch(`/api/drive/push/${type}`, { method: 'POST' });
    const d = await r.json();
    setDriveSyncing(null);
    const msg = d.ok ? `Pushed ${d.count != null ? d.count + ' rows' : ''}`.trim() : (d.error || 'Push failed');
    setDriveMsg(prev => ({ ...prev, [key]: msg }));
    setTimeout(() => setDriveMsg(prev => ({ ...prev, [key]: null })), 4000);
  };

  const applyTheme = (th) => {
    setTweak('accent', th.accent);
    setTweak('accent2', th.accent2);
  };

  const currentTheme = THEMES.find(th => th.accent === tweaks.accent);

  const resetAllData = async () => {
    if (!resetConfirm) { setResetConfirm(true); return; }
    await fetch('/api/data/reset', { method: 'POST' });
    setResetConfirm(false);
    window.__toast?.('All data cleared', 'success');
  };

  /* ── Section: Account ──────────────────────────── */
  const sAccount = (
    <div>
      <SectionHead>Profile</SectionHead>
      <FieldRow label="Display Name" desc="Shown in greetings and your dashboard.">
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="input" value={profileName} onChange={e => setProfileName(e.target.value)}
            style={{ width: 160 }} onKeyDown={e => e.key === 'Enter' && saveName()} />
          <button className="btn primary" onClick={saveName}>Save</button>
        </div>
        {nameMsg && <span style={{ fontSize: 11, color: nameMsg.ok ? 'var(--accent-2)' : 'var(--danger)' }}>{nameMsg.text}</span>}
      </FieldRow>

      <SectionHead style={{ marginTop: 24 }}>Security</SectionHead>
      <FieldRow label="Change Password" desc="Updates the password for this Mission Control instance.">
        <input className="input" type="password" placeholder="Current password" value={curPw}
          onChange={e => setCurPw(e.target.value)} style={{ width: 220 }} />
        <input className="input" type="password" placeholder="New password (min 4 chars)" value={newPw}
          onChange={e => setNewPw(e.target.value)} style={{ width: 220 }} />
        <button className="btn primary" onClick={changePassword} disabled={!curPw || !newPw || newPw.length < 4}
          style={{ alignSelf: 'flex-end' }}>
          Update password
        </button>
        {pwMsg && <span style={{ fontSize: 11, color: pwMsg.ok ? 'var(--accent-2)' : 'var(--danger)' }}>{pwMsg.text}</span>}
      </FieldRow>

      <SectionHead style={{ marginTop: 24 }}>Session</SectionHead>
      <FieldRow label="Re-run Setup" desc="Restart the onboarding wizard to reconfigure your profile, modules, and integrations.">
        <button className="btn" onClick={() => { onReEnroll(); onClose(); }}>
          <Icon name="sparkles" size={13} /> Re-enroll
        </button>
      </FieldRow>
      <FieldRow label="Sign Out" desc="End your current session and return to the login screen.">
        <button className="btn st-danger-btn" onClick={onLogout}>Sign out</button>
      </FieldRow>
    </div>
  );

  /* ── Section: Appearance ───────────────────────── */
  const sAppearance = (
    <div>
      <SectionHead>Themes</SectionHead>
      <p style={{ color: 'var(--ink-3)', fontSize: 12.5, margin: '0 0 12px' }}>
        Choose a preset color theme. Themes set both the primary accent and secondary highlight color.
      </p>
      <div className="st-theme-grid">
        {THEMES.map(th => (
          <div key={th.id} className="st-theme-swatch" onClick={() => applyTheme(th)}>
            <div className={"st-theme-ring" + (currentTheme?.id === th.id ? " selected" : "")}>
              <div className="st-theme-dot"
                style={{ background: `linear-gradient(135deg, ${th.accent} 50%, ${th.accent2} 50%)` }} />
            </div>
            <span className="st-theme-name">{th.name}</span>
          </div>
        ))}
      </div>

      <SectionHead style={{ marginTop: 24 }}>Interface</SectionHead>
      <FieldRow label="Density" desc="Controls the spacing and size of UI elements.">
        <SegButtons options={["compact", "balanced", "airy"]}
          value={tweaks.density} onChange={v => setTweak("density", v)} />
      </FieldRow>
      <FieldRow label="Sidebar" desc="Show the full sidebar, icon-only, or hide it entirely.">
        <SegButtons options={["full", "icons", "hidden"]}
          value={tweaks.sidebar} onChange={v => setTweak("sidebar", v)} />
      </FieldRow>

      <SectionHead style={{ marginTop: 24 }}>Custom Color</SectionHead>
      <FieldRow label="Accent Color" desc="Override the theme's primary accent with any custom color.">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="color" value={tweaks.accent}
            onChange={e => setTweak("accent", e.target.value)}
            style={{ width: 40, height: 30, border: '1px solid var(--line)', borderRadius: 'var(--r)', cursor: 'pointer', background: 'var(--surface-2)', padding: 2 }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--ink-3)' }}>{tweaks.accent}</span>
        </div>
      </FieldRow>
      <FieldRow label="Secondary Color" desc="Override the secondary highlight color (used in progress bars, habits, etc.).">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="color" value={tweaks.accent2 || "#6ed3b6"}
            onChange={e => setTweak("accent2", e.target.value)}
            style={{ width: 40, height: 30, border: '1px solid var(--line)', borderRadius: 'var(--r)', cursor: 'pointer', background: 'var(--surface-2)', padding: 2 }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--ink-3)' }}>{tweaks.accent2 || "#6ed3b6"}</span>
        </div>
      </FieldRow>
    </div>
  );

  /* ── Section: Modules ──────────────────────────── */
  const sModules = (
    <div>
      <SectionHead>Visible Modules</SectionHead>
      <p style={{ color: 'var(--ink-3)', fontSize: 12.5, margin: '0 0 14px' }}>
        Toggle which module cards appear on your dashboard. Hidden modules are still accessible via the sidebar.
      </p>
      {MODULE_LIST.map(m => (
        <div key={m.id} className="st-field">
          <Icon name={m.icon} size={15}
            style={{ color: tweaks.modules?.[m.id] !== false ? 'var(--accent)' : 'var(--ink-4)', flexShrink: 0, marginTop: 1 }} />
          <div className="st-field-info" style={{ marginLeft: 2 }}>
            <div className="st-field-label">{m.label}</div>
          </div>
          <Toggle value={tweaks.modules?.[m.id] !== false}
            onChange={v => setTweak("modules", { ...tweaks.modules, [m.id]: v })} />
        </div>
      ))}
    </div>
  );

  /* ── Section: Integrations ─────────────────────── */
  const sIntegrations = (
    <div>
      <SectionHead>Connected Services</SectionHead>

      {integStatus !== null && !integStatus.calSetup && (
        <div style={{ padding: '12px 14px', marginBottom: 12, background: 'color-mix(in oklch, var(--warning, #e0a857) 10%, var(--surface-2))', border: '1px solid color-mix(in oklch, var(--warning, #e0a857) 30%, var(--line))', borderRadius: 'var(--r)', fontSize: 12 }}>
          <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: 6 }}>Google credentials not set up</div>
          <div style={{ color: 'var(--ink-2)', marginBottom: 10 }}>
            Download your <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>credentials.json</code> from GCP → APIs &amp; Services → Credentials, then upload it here.
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '5px 12px', background: 'var(--accent)', color: 'var(--bg)', borderRadius: 'var(--r)', fontSize: 11.5, fontWeight: 600 }}>
            Upload credentials.json
            <input type="file" accept=".json,application/json" style={{ display: 'none' }}
              onChange={async e => {
                const file = e.target.files[0];
                if (!file) return;
                const text = await file.text();
                try { JSON.parse(text); } catch { alert('Invalid JSON file'); return; }
                const res = await fetch('/api/credentials/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text }) });
                if (res.ok) { alert('Uploaded! Reloading…'); window.location.reload(); }
                else { const d = await res.json(); alert('Upload failed: ' + (d.error || 'unknown error')); }
              }} />
          </label>
        </div>
      )}

      <div className="st-integ-card">
        <div className="st-integ-icon" style={{ background: 'color-mix(in oklch, var(--info) 10%, var(--surface-2))' }}>
          <Icon name="calendar" size={18} style={{ color: 'var(--info)' }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500, fontSize: 13 }}>Google Calendar</div>
          <div style={{ color: 'var(--ink-3)', fontSize: 11.5, marginTop: 2 }}>
            {integStatus === null ? 'Checking status…' :
              !integStatus.calSetup ? 'Waiting for credentials.json' :
              integStatus.calendar ? 'Connected — events synced from your calendar' :
              'Ready — click Connect to authorize'}
          </div>
        </div>
        {integStatus?.calendar
          ? <span className="tag mint">Connected</span>
          : integStatus?.calSetup === false
            ? <span className="tag" style={{ color: 'var(--ink-4)', fontSize: 10 }}>Needs setup</span>
            : <button className="btn primary" onClick={connectCalendar}
                disabled={calConnecting}
                style={{ fontSize: 11.5, padding: '5px 10px' }}>
                <Icon name={calConnecting ? "loader" : "calendar"} size={12} />
                {calConnecting ? 'Opening…' : 'Connect'}
              </button>
        }
      </div>

      <div className="st-integ-card" style={{ marginTop: 10 }}>
        <div className="st-integ-icon" style={{ background: 'color-mix(in oklch, #e0a857 10%, var(--surface-2))' }}>
          <Icon name="file" size={18} style={{ color: '#e0a857' }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500, fontSize: 13 }}>Google Drive — Sheets Sync</div>
          <div style={{ color: 'var(--ink-3)', fontSize: 11.5, marginTop: 2 }}>
            {integStatus === null ? 'Checking status…' :
              !integStatus.driveSetup ? 'Waiting for credentials.json' :
              integStatus.drive ? 'Connected — paste sheet URLs below to sync' :
              'Ready — click Connect to authorize'}
          </div>
        </div>
        {integStatus?.drive
          ? <span className="tag mint">Connected</span>
          : integStatus?.driveSetup === false
            ? <span className="tag" style={{ color: 'var(--ink-4)', fontSize: 10 }}>Needs setup</span>
            : <button className="btn primary" onClick={connectDrive}
                style={{ fontSize: 11.5, padding: '5px 10px' }}>
                <Icon name="external" size={12} /> Connect
              </button>
        }
      </div>

      {integStatus?.drive && (
        <div style={{ marginTop: 10, padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 'var(--r)', border: '1px solid var(--line)' }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 6, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Finance Sheet</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="input" placeholder="Google Sheets URL or ID"
                value={sheetFinance} onChange={e => setSheetFinance(e.target.value)}
                style={{ flex: 1, minWidth: 180, fontSize: 11.5 }} />
              <button className="btn" style={{ fontSize: 11, padding: '4px 9px', whiteSpace: 'nowrap' }}
                onClick={() => syncDrive('finances')} disabled={!sheetFinance || driveSyncing === 'finances'}>
                {driveSyncing === 'finances' ? '…' : '↓ Drive→Local'}
              </button>
              <button className="btn" style={{ fontSize: 11, padding: '4px 9px', whiteSpace: 'nowrap' }}
                onClick={() => pushDrive('finances')} disabled={!sheetFinance || driveSyncing === 'push-finances'}>
                {driveSyncing === 'push-finances' ? '…' : '↑ Local→Drive'}
              </button>
            </div>
            {(driveMsg.finances || driveMsg['push-finances']) && (
              <div style={{ fontSize: 11, color: 'var(--accent-2)', marginTop: 5 }}>
                {driveMsg.finances || driveMsg['push-finances']}
              </div>
            )}
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 6, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Band Contacts Sheet</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="input" placeholder="Google Sheets URL or ID"
                value={sheetContacts} onChange={e => setSheetContacts(e.target.value)}
                style={{ flex: 1, minWidth: 180, fontSize: 11.5 }} />
              <button className="btn" style={{ fontSize: 11, padding: '4px 9px', whiteSpace: 'nowrap' }}
                onClick={() => syncDrive('contacts')} disabled={!sheetContacts || driveSyncing === 'contacts'}>
                {driveSyncing === 'contacts' ? '…' : '↓ Drive→Local'}
              </button>
              <button className="btn" style={{ fontSize: 11, padding: '4px 9px', whiteSpace: 'nowrap' }}
                onClick={() => pushDrive('contacts')} disabled={!sheetContacts || driveSyncing === 'push-contacts'}>
                {driveSyncing === 'push-contacts' ? '…' : '↑ Local→Drive'}
              </button>
            </div>
            {(driveMsg.contacts || driveMsg['push-contacts']) && (
              <div style={{ fontSize: 11, color: 'var(--accent-2)', marginTop: 5 }}>
                {driveMsg.contacts || driveMsg['push-contacts']}
              </div>
            )}
          </div>

          <button className="btn primary" style={{ fontSize: 11.5, padding: '5px 12px' }} onClick={saveSheets}>
            Save Sheet IDs
          </button>
        </div>
      )}

      <SectionHead style={{ marginTop: 24 }}>Coming Soon</SectionHead>
      {[
        { icon: "heart",      name: "Apple Health / Google Fit", desc: "Sync workouts, steps, weight and vitals automatically" },
        { icon: "briefcase",  name: "Slack / Teams",             desc: "Surface messages, DMs, and action items" },
        { icon: "book",       name: "Notion / Obsidian",         desc: "Import pages as tasks or journal entries" },
        { icon: "trending-up", name: "Strava / Garmin",          desc: "Sync run and ride data to Health module" },
      ].map(item => (
        <div key={item.name} className="st-integ-card" style={{ marginTop: 8, opacity: .45 }}>
          <div className="st-integ-icon">
            <Icon name={item.icon} size={17} style={{ color: 'var(--ink-3)' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500, fontSize: 12.5, color: 'var(--ink-2)' }}>{item.name}</div>
            <div style={{ color: 'var(--ink-4)', fontSize: 11.5, marginTop: 2 }}>{item.desc}</div>
          </div>
          <span className="tag" style={{ color: 'var(--ink-4)', fontSize: 10, opacity: .7 }}>Soon</span>
        </div>
      ))}
    </div>
  );

  /* ── Section: Data ─────────────────────────────── */
  const sData = (
    <div>
      <SectionHead>Backup & Export</SectionHead>
      <FieldRow label="Export All Data" desc="Download all your module data as a ZIP archive of JSON files.">
        <a href="/api/data/export" download>
          <button className="btn"><Icon name="download" size={13} /> Export .zip</button>
        </a>
      </FieldRow>

      <SectionHead style={{ marginTop: 24 }}>Storage</SectionHead>
      <FieldRow label="Data Location" desc="Where your data files live on disk.">
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)', maxWidth: 200, textAlign: 'right', wordBreak: 'break-all' }}>
          ./data/
        </span>
      </FieldRow>
      <FieldRow label="Activity Log" desc="SQLite log of recent actions (last 500 entries).">
        <button className="btn" onClick={async () => {
          await fetch('/api/activity', { method: 'DELETE' });
          window.__toast?.('Activity log cleared', 'success');
        }}>Clear log</button>
      </FieldRow>

      <SectionHead style={{ marginTop: 24 }}>Danger Zone</SectionHead>
      <div className="st-danger-zone">
        <FieldRow label="Reset All Data"
          desc="Permanently delete all module data — transactions, tasks, health logs, journal, etc. This cannot be undone."
          style={{ borderBottom: resetConfirm ? '1px solid color-mix(in oklch, var(--danger) 20%, var(--line))' : 'none' }}>
          <button
            className="btn"
            style={{
              color: 'var(--danger)',
              borderColor: 'color-mix(in oklch, var(--danger) 30%, var(--line))',
              background: resetConfirm ? 'color-mix(in oklch, var(--danger) 14%, var(--surface-2))' : undefined
            }}
            onClick={resetAllData}>
            {resetConfirm ? "Confirm — delete everything" : "Reset all data"}
          </button>
        </FieldRow>
        {resetConfirm && (
          <div style={{ textAlign: 'right', paddingTop: 8 }}>
            <button className="btn ghost" onClick={() => setResetConfirm(false)}
              style={{ color: 'var(--ink-3)', fontSize: 11.5 }}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );

  /* ── Section: About ────────────────────────────── */
  const sAbout = (
    <div>
      <SectionHead>Mission Control</SectionHead>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {[
          ["Version",    "1.0.0"],
          ["Stack",      "Flask · React · Claude API"],
          ["Model",      "claude-sonnet-4-6"],
          ["Storage",    "Local JSON · SQLite activity log"],
          ["Auth",       "Session-based password login"],
        ].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--line-soft)', alignItems: 'baseline' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-4)', width: 80, flexShrink: 0 }}>{k}</span>
            <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{v}</span>
          </div>
        ))}
      </div>

      <SectionHead style={{ marginTop: 24 }}>Keyboard Shortcuts</SectionHead>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {[
          ["⌘K",    "Open command palette"],
          ["Enter", "Submit Talk bar"],
          ["Esc",   "Close any open panel"],
        ].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--line-soft)' }}>
            <span className="kbd" style={{ minWidth: 44, textAlign: 'center', flexShrink: 0 }}>{k}</span>
            <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{v}</span>
          </div>
        ))}
      </div>

      <SectionHead style={{ marginTop: 24 }}>Talk Bar Shortcuts</SectionHead>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {[
          ["spent $X at Y",    "→ Log transaction"],
          ["gig at X on date", "→ Add show"],
          ["remind me to…",    "→ Set reminder"],
          ["weigh Xlb",        "→ Log weight"],
          ["journal: …",       "→ Save journal entry"],
        ].map(([trigger, action]) => (
          <div key={trigger} style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--line-soft)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', minWidth: 140, flexShrink: 0 }}>{trigger}</span>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{action}</span>
          </div>
        ))}
      </div>
    </div>
  );

  const contentMap = {
    account: sAccount, appearance: sAppearance, modules: sModules,
    integrations: sIntegrations, data: sData, about: sAbout,
  };

  return (
    <div className="st-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="st-panel">
        {/* Header */}
        <div className="st-head">
          <Icon name="settings" size={14} style={{ color: 'var(--ink-3)' }} />
          <h2 className="st-head-title">Settings</h2>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">
            <Icon name="x" size={14} />
          </button>
        </div>

        {/* Left nav */}
        <nav className="st-nav">
          {ST_SECTIONS.map(s => (
            <div key={s.id} className={"st-nav-item" + (section === s.id ? " active" : "")}
              onClick={() => setSection(s.id)}>
              <Icon name={s.icon} size={14} />
              <span>{s.label}</span>
            </div>
          ))}
        </nav>

        {/* Right content */}
        <div className="st-content">
          {contentMap[section]}
        </div>
      </div>
    </div>
  );
};

window.SettingsPanel = SettingsPanel;
window.THEMES = THEMES;
