/* Goal Input — describe-your-goal screen */

const EXAMPLES = [
  'Get more weekend customers to my café',
  'Launch my Etsy shop with no audience yet',
  'Build an email list of 1,000 in 90 days',
  'Promote my freelance design service locally',
  'Grow my newsletter past 500 subscribers',
];

function GoalInput({ setRoute, goal, setGoal, tone }) {
  const taRef = React.useRef(null);

  React.useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.max(110, ta.scrollHeight) + 'px';
  }, [goal]);

  const submit = () => {
    if (!goal.trim()) return;
    setRoute('thinking');
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
  };

  const headlines = {
    expert: <>What do you want to <em>achieve</em>?</>,
    coach:  <>Let's figure out your <em>next big win</em>.</>,
    peer:   <>So... <em>what's the dream</em>?</>,
    pro:    <>Define the <em>objective</em>.</>,
  };
  const subs = {
    expert: 'Tell me the outcome — in your own words. I\'ll handle the strategy.',
    coach:  'Tell me where you want to be. I\'ll break it down into wins we can hit this week.',
    peer:   'Just type it like you\'d tell a friend. No marketing jargon required.',
    pro:    'Describe the desired business outcome. Be as specific as you can.',
  };

  return (
    <div className="goal-page">
      <div className="goal-eyebrow">
        <span className="chip chip-accent">
          <Icon.Sparkle style={{ width: 11, height: 11 }} />
          New strategy
        </span>
        <span className="t-mono" style={{ fontSize: 11, color: 'var(--text-mute)', letterSpacing: '0.04em' }}>
          STEP 1 OF 3
        </span>
      </div>

      <h1 className="goal-headline">{headlines[tone]}</h1>
      <p className="goal-sub">{subs[tone]}</p>

      <div className="goal-input-wrap">
        <textarea
          ref={taRef}
          className="goal-textarea"
          placeholder="e.g. I run a small bakery in Brooklyn and I want more weekend customers. We make sourdough and pastries, mostly walk-ins, and Saturdays are quiet…"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={onKey}
          autoFocus
        />
        <div className="goal-input-bar">
          <button className="goal-attach">
            <Icon.Paperclip style={{ width: 13, height: 13 }} />
            Attach brand brief
          </button>
          <button className="goal-attach">
            <Icon.Mic style={{ width: 13, height: 13 }} />
            Voice
          </button>
          <div style={{ flex: 1 }} />
          <span className="t-mono" style={{ fontSize: 10.5, color: 'var(--text-faint)', letterSpacing: '0.04em' }}>
            ⌘ + ↵ TO RUN
          </span>
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={!goal.trim()}
            style={{ opacity: goal.trim() ? 1 : 0.5 }}
          >
            Build my plan
            <Icon.ArrowRight style={{ width: 13, height: 13 }} />
          </button>
        </div>
      </div>

      <div className="goal-examples">
        <div className="goal-examples-label">OR TRY ONE OF THESE</div>
        <div className="goal-chips">
          {EXAMPLES.map((ex, i) => (
            <button key={i} className="goal-chip" onClick={() => setGoal(ex)}>
              {ex}
            </button>
          ))}
        </div>
      </div>

      <div className="goal-tip">
        <Icon.Info style={{ width: 12, height: 12, verticalAlign: -2, marginRight: 4, opacity: 0.7 }} />
        The more you tell me — who you serve, what you sell, what's working — the sharper the plan.
      </div>
    </div>
  );
}

Object.assign(window, { GoalInput });
