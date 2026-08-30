/* Settings — two things only: what this app is connected to, and your data.
   Appearance and the theme presets went with the skin; the account section went
   with password login (sign-in is Google + 2FA in production). */

const SettingsPanel = ({ open, onClose, onLogout }) => {
  const [me, setMe] = useState(null);
  const [drive, setDrive] = useState(null);
  const [sheetFinance, setSheetFinance] = useState("");
  const [importFolder, setImportFolder] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);

  useEffect(() => {
    if (!open) return;
    setResetConfirm(false);
    fetch('/api/me').then(r => r.json()).then(setMe).catch(() => {});
    fetch('/api/drive/status').then(r => r.json()).catch(() => ({ connected: false }))
      .then(d => {
        setDrive(d);
        if (d.sheet_finance) setSheetFinance(d.sheet_finance);
        if (d.finance_import_folder) setImportFolder(d.finance_import_folder);
      });
  }, [open]);

  if (!open) return null;

  const connectDrive = async () => {
    const r = await fetch('/api/drive/auth');
    const d = await r.json();
    if (d.auth_url) window.location.href = d.auth_url;
    else toastErr(d.error || 'Google credentials not found — upload credentials.json first.');
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      const r = await fetch('/api/drive/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheet_finance: sheetFinance.trim(),
          finance_import_folder: importFolder.trim(),
        }),
      });
      const d = await r.json();
      if (d.ok) toastOk('Saved.');
      else toastErr(d.error || 'Save failed');
    } catch { toastErr('Save failed'); }
    finally { setSaving(false); }
  };

  const resetData = async () => {
    await fetch('/api/data/reset', { method: 'POST' });
    toastOk('Local finance data cleared.');
    setResetConfirm(false);
    window.dispatchEvent(new CustomEvent('mc:refresh'));
  };

  const connected = drive && drive.connected;

  return (
    <div className="st-overlay" onClick={onClose}>
      <div className="st-panel" onClick={e => e.stopPropagation()} role="dialog" aria-label="Settings">
        <div className="st-head">
          <h2>Settings</h2>
          <button className="btn ghost icon-only" onClick={onClose} aria-label="Close settings">
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="st-body">
          <section className="st-section">
            <h3>Google Drive &amp; Sheets</h3>
            <p className="st-hint">
              The finance Sheet is the record; the Rocket Money CSV export in your Drive folder is
              what it reconciles against.
            </p>

            <div className="st-status">
              <span className={"st-dot " + (connected ? "ok" : "off")} aria-hidden="true" />
              <span>{connected ? 'Connected' : 'Not connected'}</span>
              {drive && drive.email && <span className="muted-2">· {drive.email}</span>}
              {!connected && (
                <button className="btn primary inline" onClick={connectDrive}>
                  <Icon name="external" size={12} />Connect
                </button>
              )}
            </div>

            {drive && drive.setup_required && (
              <p className="st-warn">
                No OAuth client on file. Upload <code>credentials.json</code> to <code>data/</code>,
                then run <code>scripts\sheets-reauth.ps1</code>.
              </p>
            )}

            <label className="st-field">
              <span>Finance Sheet ID</span>
              <input className="input" value={sheetFinance} placeholder="1UaFkSQ3ww…"
                     onChange={e => setSheetFinance(e.target.value)} />
            </label>
            <label className="st-field">
              <span>Rocket Money import folder</span>
              <input className="input" value={importFolder} placeholder="Drive folder ID or URL"
                     onChange={e => setImportFolder(e.target.value)} />
            </label>
            <button className="btn primary" onClick={saveConfig} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </section>

          <section className="st-section">
            <h3>Data</h3>
            <p className="st-hint">
              Export downloads the local JSON cache. Reset clears it — the Google Sheet is untouched,
              and the next sync repopulates from it.
            </p>
            <div className="st-actions">
              <a className="btn" href="/api/data/export" download>
                <Icon name="download" size={13} />Export
              </a>
              {resetConfirm ? (
                <>
                  <button className="btn danger" onClick={resetData}>Really reset</button>
                  <button className="btn ghost" onClick={() => setResetConfirm(false)}>Cancel</button>
                </>
              ) : (
                <button className="btn ghost" onClick={() => setResetConfirm(true)}>Reset local data</button>
              )}
            </div>
          </section>

          <section className="st-section">
            <h3>Session</h3>
            <div className="st-status">
              <span className="muted-2">{me && me.email ? me.email : 'Signed in'}</span>
            </div>
            <button className="btn ghost" onClick={onLogout}>
              <Icon name="logout" size={13} />Sign out
            </button>
          </section>
        </div>
      </div>
    </div>
  );
};

window.SettingsPanel = SettingsPanel;
