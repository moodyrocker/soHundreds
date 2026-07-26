/* App — main router + Tweaks panel wiring */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "ink",
  "tone": "expert",
  "density": "comfortable",
  "hideAids": false
}/*EDITMODE-END*/;

const THEME_PALETTES = {
  ink:   [['#FFFFFF', '#0A0A0B', '#71717A']],
  paper: [['#F7F4EF', '#14110A', '#7A7363']],
  lime:  [['#1C1F23', '#E4E4E7', '#888892']],
};

const THEME_OPTIONS = [
  { value: 'ink',   label: 'Ink',   palette: THEME_PALETTES.ink[0] },
  { value: 'paper', label: 'Paper', palette: THEME_PALETTES.paper[0] },
  { value: 'lime',  label: 'Slate', palette: THEME_PALETTES.lime[0] },
];

function ThemeSwatches({ value, onChange }) {
  return (
    <div className="twk-row">
      <div className="twk-lbl"><span>Palette</span></div>
      <div style={{ display: 'flex', gap: 8 }}>
        {THEME_OPTIONS.map((o) => {
          const [bg, accent, fg] = o.palette;
          const active = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              title={o.label}
              style={{
                position: 'relative',
                width: 56, height: 40, padding: 0,
                borderRadius: 0,
                border: '1.5px solid ' + (active ? 'var(--accent, #F5F5F7)' : 'rgba(0,0,0,0.1)'),
                background: bg,
                cursor: 'pointer',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'flex-end',
                padding: 4,
                boxShadow: active ? '0 0 0 3px rgba(120,120,130,0.18)' : 'none',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ position: 'absolute', top: 4, left: 4, fontSize: 9, fontWeight: 600, color: fg, fontFamily: 'inherit', letterSpacing: '0.02em' }}>
                {o.label}
              </div>
              <div style={{ display: 'flex', gap: 3 }}>
                <span style={{ width: 10, height: 10, borderRadius: 0, background: accent, boxShadow: '0 0 0 1px rgba(255,255,255,0.15) inset' }} />
                <span style={{ width: 10, height: 10, borderRadius: 0, background: fg, boxShadow: '0 0 0 1px rgba(0,0,0,0.1) inset' }} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function App() {
  const [route, setRoute] = React.useState('dashboard');
  const [goal, setGoal] = React.useState('I run a small bakery in Brooklyn — I want more weekend customers.');
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Apply theme + density to the app shell
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', t.theme);
    document.documentElement.setAttribute('data-density', t.density);
  }, [t.theme, t.density]);

  // Reset to thinking → plan flow when entering 'thinking'
  // (handled inside Thinking via auto-advance)

  const crumbs = {
    dashboard: ['Hundres', "Maya's Bakery", 'Home'],
    goal:      ['Hundres', "Maya's Bakery", 'New plan'],
    thinking:  ['Hundres', "Maya's Bakery", 'Working…'],
    plan:      ['Hundres', "Maya's Bakery", 'Weekend Push'],
  };

  return (
    <div className={`app${t.hideAids ? ' hide-aids' : ''}`} data-screen-label={`screen-${route}`}>
      <Sidebar route={route} setRoute={setRoute} />
      <main className="main">
        <TopBar crumb={crumbs[route]} />
        <div className="content" data-screen-label={
          route === 'dashboard' ? '01 Dashboard' :
          route === 'goal' ? '02 Goal input' :
          route === 'thinking' ? '03 Thinking' :
          '04 Plan'
        }>
          {route === 'dashboard' && <Dashboard setRoute={setRoute} tone={t.tone} />}
          {route === 'goal' && <GoalInput setRoute={setRoute} goal={goal} setGoal={setGoal} tone={t.tone} />}
          {route === 'thinking' && <Thinking setRoute={setRoute} goal={goal} tone={t.tone} />}
          {route === 'plan' && <PlanScreen setRoute={setRoute} tone={t.tone} hideAids={t.hideAids} />}
        </div>
      </main>

      <TweaksPanel title="Tweaks">
        <TweakSection label="Theme">
          <ThemeSwatches value={t.theme} onChange={(v) => setTweak('theme', v)} />
          <TweakRadio
            label="Density"
            value={t.density}
            onChange={(v) => setTweak('density', v)}
            options={[
              { value: 'cozy', label: 'Cozy' },
              { value: 'comfortable', label: 'Comfy' },
              { value: 'spacious', label: 'Spacious' },
            ]}
          />
        </TweakSection>

        <TweakSection label="AI personality">
          <TweakSelect
            label="Tone"
            value={t.tone}
            onChange={(v) => setTweak('tone', v)}
            options={[
              { value: 'expert', label: 'Expert mentor — confident & direct' },
              { value: 'coach',  label: 'Coach — encouraging & motivating' },
              { value: 'peer',   label: 'Friendly peer — casual & chatty' },
              { value: 'pro',    label: 'Pro strategist — formal & polished' },
            ]}
          />
        </TweakSection>

        <TweakSection label="Novice aids">
          <TweakToggle
            label="Show 'why this works' on plan"
            value={!t.hideAids}
            onChange={(v) => setTweak('hideAids', !v)}
          />
        </TweakSection>

        <TweakSection label="Navigate">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {[
              ['dashboard', 'Dashboard'],
              ['goal', 'Goal input'],
              ['thinking', 'Thinking'],
              ['plan', 'Plan'],
            ].map(([r, label]) => (
              <button
                key={r}
                onClick={() => setRoute(r)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 0,
                  border: '1px solid ' + (route === r ? 'var(--accent)' : 'rgba(0,0,0,0.1)'),
                  background: route === r ? 'var(--accent)' : 'transparent',
                  color: route === r ? 'var(--accent-on)' : 'inherit',
                  fontSize: 12,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
