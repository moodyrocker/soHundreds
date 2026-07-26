/* Thinking — live AI reasoning stream */

function buildSteps(tone) {
  // Tone-flavored step labels; details are the "found insights"
  const base = [
    {
      title: 'Understanding your business',
      coach:  'Got it — small bakery in Brooklyn, weekend foot traffic, walk-in heavy.',
      expert: 'Parsing context: small bakery, Brooklyn, weekend foot traffic, walk-in model.',
      peer:   'Okay so — a bakery in Brooklyn that wants busier weekends. Cute.',
      pro:    'Context: B2C food retail, Brooklyn, weekend conversion focus.',
      details: [
        ['Type', 'B2C food retail · neighborhood'],
        ['Geo', 'Brooklyn, NY (Park Slope likely)'],
        ['Goal lens', 'Weekend foot traffic → loyalty'],
      ],
    },
    {
      title: 'Researching your local audience',
      coach:  'Pulling who actually buys pastries in your neighborhood on weekends.',
      expert: 'Profiling local weekend-pastry buyers within a 1.2 mi radius.',
      peer:   'Looking up who buys pastries in your hood on a Saturday morning.',
      pro:    'Segmenting weekend retail traffic in target catchment area.',
      details: [
        ['Primary', 'Young families, 28–42, brunch-adjacent'],
        ['Secondary', 'Remote workers, weekend treaters'],
        ['Decision trigger', 'Visual cravings — Reels, Stories'],
      ],
    },
    {
      title: 'Analyzing five local competitors',
      coach:  'Sized up five bakeries on your block. Two are crushing Instagram, one isn\'t.',
      expert: 'Benchmarked 5 nearby bakeries across Instagram, Google, and reviews.',
      peer:   'Checked out your block. Some of these places have weak Instagrams, honestly.',
      pro:    'Competitive analysis across 5 SMB peers complete.',
      details: [
        ['Top performer', 'Posts 11×/wk · 80% Reels'],
        ['Weakest signal', '4 of 5 have stale Google profiles'],
        ['Gap to exploit', 'No one is doing weekend-preview content'],
      ],
    },
    {
      title: 'Identifying high-impact channels',
      coach:  'Three channels will do 90% of the work. I\'ll skip the rest.',
      expert: 'Channel mix prioritized by ROI and effort-to-impact ratio.',
      peer:   'Three things matter, the rest is noise. Trust me.',
      pro:    'Channel selection: Instagram Reels, Google Business, email list.',
      details: [
        ['#1', 'Instagram Reels — high reach, low cost'],
        ['#2', 'Google Business — captures intent traffic'],
        ['#3', 'Email — owns the relationship'],
      ],
    },
    {
      title: 'Drafting your 8-week plan',
      coach:  'Composing weekly actions. Week 1 is light on purpose — let\'s build the habit.',
      expert: 'Generating 8-week roadmap with progressive complexity.',
      peer:   'Writing this out. Don\'t worry — I\'m not gonna ask you to do 30 things a day.',
      pro:    'Synthesizing time-phased plan with weekly KPIs.',
      details: [
        ['Cadence', '3–5 actions per week'],
        ['Time budget', '~45 min / weekday'],
        ['First win', 'Visible by week 2'],
      ],
    },
    {
      title: 'Writing the "why" behind every action',
      coach:  'Almost done. Adding a plain-English reason next to every task — so you know why.',
      expert: 'Annotating each action with rationale and expected outcome.',
      peer:   'Adding little explainer notes so nothing feels like a black box.',
      pro:    'Attaching justification + KPI per action.',
      details: [
        ['Total actions', '24 across 8 weeks'],
        ['Estimated lift', '+40–60% weekend traffic'],
        ['Confidence', 'High — proven local SMB playbook'],
      ],
    },
  ];
  return base.map(s => ({
    title: s.title,
    line: s[tone] || s.expert,
    details: s.details,
  }));
}

function Thinking({ setRoute, goal, tone }) {
  const steps = React.useMemo(() => buildSteps(tone), [tone]);
  const [current, setCurrent] = React.useState(0);
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    if (current >= steps.length) return;
    const stepDuration = current === steps.length - 1 ? 2400 : 2000;
    const t = setTimeout(() => {
      if (current === steps.length - 1) {
        setRoute('plan');
      } else {
        setCurrent(c => c + 1);
      }
    }, stepDuration);
    return () => clearTimeout(t);
  }, [current, steps.length, setRoute]);

  React.useEffect(() => {
    const t = setInterval(() => setElapsed(e => e + 0.1), 100);
    return () => clearInterval(t);
  }, []);

  const goalText = goal || 'Get more weekend customers to my Brooklyn bakery';

  const statusLines = {
    expert: ['Synthesizing strategy', 'Processing', 'Composing plan'],
    coach:  ['Building your win plan', 'Researching for you', 'Almost there'],
    peer:   ['Doing the thinking', 'Looking stuff up', 'Wrapping it up'],
    pro:    ['Generating strategy', 'Analyzing', 'Compiling roadmap'],
  };
  const statusIdx = Math.min(2, Math.floor(current / 2));

  return (
    <div className="thinking-page">
      <div className="thinking-goalcard">
        <Icon.Target style={{ width: 22, height: 22, color: 'var(--accent)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="label">YOUR GOAL</div>
          <div style={{ fontSize: 14.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{goalText}</div>
        </div>
        <button className="btn btn-ghost" style={{ height: 28, fontSize: 12 }} onClick={() => setRoute('goal')}>
          <Icon.Edit style={{ width: 12, height: 12 }} />
          Edit
        </button>
      </div>

      <div className="thinking-status">
        <div className="thinking-pulse" />
        <div className="thinking-status-text">
          <strong>{statusLines[tone][statusIdx]}</strong>
          <span className="thinking-cursor" />
        </div>
        <div className="timer">{elapsed.toFixed(1)}s</div>
      </div>

      <div className="steps">
        {steps.map((s, i) => {
          const state = i < current ? 'done' : i === current ? 'active' : 'pending';
          return (
            <div key={i} className={`step show ${state}`}>
              <div className="step-title">{s.line}</div>
              <div className="step-detail">
                {s.details.map((d, j) => (
                  <div key={j} className="row">
                    <span className="key">{d[0]}</span>
                    <span style={{ margin: '0 8px', color: 'var(--text-faint)' }}>—</span>
                    <span>{d[1]}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 40, display: 'flex', justifyContent: 'center', gap: 10 }}>
        <button className="btn btn-ghost" onClick={() => setRoute('goal')}>Cancel</button>
        <button className="btn" onClick={() => setRoute('plan')}>Skip to plan →</button>
      </div>
    </div>
  );
}

Object.assign(window, { Thinking });
