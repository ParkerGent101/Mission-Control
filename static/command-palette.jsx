/* Command palette ⌘K */
const { useState: useStateCP, useEffect: useEffectCP, useMemo: useMemoCP, useRef: useRefCP } = React;

const COMMANDS = [
  { group: "Quick add", icon: "wallet",    label: "Add an expense",            hint: "$",   action: "open:finance" },
  { group: "Quick add", icon: "music",     label: "Compose band post",         hint: "→ IG",action: "open:band" },
  { group: "Quick add", icon: "dumbbell",  label: "Log a workout",             hint: "💪",  action: "open:health" },
  { group: "Quick add", icon: "feather",   label: "New journal entry",         hint: "✍",  action: "open:journal" },
  { group: "Quick add", icon: "book",      label: "Log reading progress",      hint: "p.", action: "open:reading" },
  { group: "Quick add", icon: "briefcase", label: "Add a work task",           hint: "T",  action: "open:work" },
  { group: "Quick add", icon: "plane",     label: "Plan a trip",               hint: "✈", action: "open:holidays" },
  { group: "Go to",     icon: "home",      label: "Dashboard",                 hint: "G H",action: "go:dashboard" },
  { group: "Go to",     icon: "wallet",    label: "Finance",                   hint: "G F",action: "go:finance" },
  { group: "Go to",     icon: "music",     label: "Band",                      hint: "G B",action: "go:band" },
  { group: "Go to",     icon: "heart",     label: "Health & Fitness",          hint: "G P",action: "go:health" },
  { group: "Go to",     icon: "briefcase", label: "Work",                      hint: "G W",action: "go:work" },
  { group: "Go to",     icon: "book",      label: "Reading",                   hint: "G R",action: "go:reading" },
{ group: "Go to",     icon: "plane",     label: "Holidays",                  hint: "G T",action: "go:holidays" },
  { group: "Go to",     icon: "feather",   label: "Journal",                   hint: "G J",action: "go:journal" },
  { group: "Actions",   icon: "download",  label: "Export May 2026 → xlsx",    hint: "⌘E", action: "export:finance" },
  { group: "Actions",   icon: "image",     label: "Upload band photos",        hint: "",   action: "band:photos" },
  { group: "Actions",   icon: "inbox",     label: "Import bank transactions",  hint: "",   action: "fin:import" },
  { group: "Actions",   icon: "settings",  label: "Open tweaks panel",         hint: "",   action: "open:tweaks" },
];

const CommandPalette = ({ open, onClose, onAction }) => {
  const [q, setQ] = useStateCP("");
  const [active, setActive] = useStateCP(0);
  const inputRef = useRefCP(null);

  useEffectCP(() => {
    if (open) { setQ(""); setActive(0); setTimeout(() => inputRef.current?.focus(), 30); }
  }, [open]);

  const filtered = useMemoCP(() => {
    const t = q.trim().toLowerCase();
    if (!t) return COMMANDS;
    return COMMANDS.filter(c => (c.label + " " + c.group).toLowerCase().includes(t));
  }, [q]);

  useEffectCP(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") { onClose(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(filtered.length - 1, a + 1)); }
      else if (e.key === "ArrowUp")   { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
      else if (e.key === "Enter")     { e.preventDefault(); if (filtered[active]) { onAction(filtered[active]); onClose(); } }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, active, onClose, onAction]);

  if (!open) return null;
  const grouped = filtered.reduce((acc, c) => { (acc[c.group] = acc[c.group] || []).push(c); return acc; }, {});
  let idx = -1;

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div className="cmd-panel" onClick={(e) => e.stopPropagation()}>
        <div className="cmd-input">
          <Icon name="search" size={16} />
          <input ref={inputRef} placeholder="Type a command, or search…" value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }} />
          <span className="kbd">esc</span>
        </div>
        <div className="cmd-list">
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group}>
              <div className="cmd-group-label">{group}</div>
              {items.map((c) => { idx++; const isActive = idx === active; return (
                <div key={c.label} className={"cmd-item" + (isActive ? " active" : "")}
                  onMouseEnter={() => setActive(idx)} onClick={() => { onAction(c); onClose(); }}>
                  <Icon name={c.icon} size={15} className="ci-icon" />
                  <span className="ci-label">{c.label}</span>
                  <span className="ci-hint">{c.hint}</span>
                </div>
              ); })}
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 28, textAlign: "center", color: "var(--ink-4)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
              No matches for "{q}"
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
window.CommandPalette = CommandPalette;
