/* Dashboard — returning user home */

function Dashboard({ setRoute, tone, persona }) {
  const [tasks, setTasks] = React.useState([
    { id: 1, title: 'Post Tuesday morning Reel — "behind the croissant"', channel: 'instagram', day: 'TUE', time: '8:00 AM', done: true },
    { id: 2, title: 'Send weekend special email to subscribers', channel: 'email', day: 'WED', time: '10:00 AM', done: true },
    { id: 3, title: 'Reply to last week\'s Google reviews', channel: 'local', day: 'WED', time: '12 min', done: false },
    { id: 4, title: 'Film "what we bake at 4am" short', channel: 'content', day: 'THU', time: '20 min', done: false },
    { id: 5, title: 'Schedule Friday weekend-preview post', channel: 'instagram', day: 'FRI', time: '5 min', done: false },
  ]);
  const toggle = (id) => setTasks(t => t.map(x => x.id === id ? { ...x, done: !x.done } : x));
  const completed = tasks.filter(t => t.done).length;
  const pct = Math.round((completed / tasks.length) * 100);

  const greetings = {
    expert: 'Good morning, Maya.',
    coach: 'Hey Maya — let\'s win the week.',
    peer: 'Maya! Welcome back ✦',
    pro: 'Maya — your weekly briefing.',
  };
  const subGreetings = {
    expert: 'You\'re on track. Two high-impact actions are queued for today.',
    coach: 'You\'re crushing it — 2 of 5 done already. Today\'s the day to film.',
    peer: 'Two things on the docket today. Easy stuff. You\'ve got this.',
    pro: 'On schedule. 2 of 5 weekly actions complete. Next action: 12 min.',
  };

  return (
    <>
      <div className="dash-greeting">
        <div>
          <div className="h-eyebrow" style={{ marginBottom: 12 }}>· WEEK 2 OF 8 · BROOKLYN BAKERY WEEKEND PUSH</div>
          <h1 className="h-display">{greetings[tone]}</h1>
          <p className="t-dim" style={{ fontSize: 17, marginTop: 10, maxWidth: 540 }}>
            {subGreetings[tone]}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => setRoute('plan')}>
            View plan
          </button>
          <button className="btn btn-primary" onClick={() => setRoute('goal')}>
            <Icon.Plus style={{ width: 14, height: 14 }} />
            New plan
          </button>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-label"><Icon.Users style={{ width: 13, height: 13 }} /> Weekend foot traffic</div>
          <div className="stat-value">142<span style={{ fontSize: 14, color: 'var(--text-mute)', fontWeight: 400, marginLeft: 6 }}>customers / wk</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
            <span className="stat-delta"><Icon.ArrowUp style={{ width: 11, height: 11 }} />+18% vs last wk</span>
            <Sparkline data={[80, 92, 88, 95, 110, 124, 142]} />
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label"><Icon.IG style={{ width: 13, height: 13 }} /> Instagram reach</div>
          <div className="stat-value">4.2K<span style={{ fontSize: 14, color: 'var(--text-mute)', fontWeight: 400, marginLeft: 6 }}>accounts / wk</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
            <span className="stat-delta"><Icon.ArrowUp style={{ width: 11, height: 11 }} />+312%</span>
            <Sparkline data={[600, 720, 980, 1400, 2200, 3100, 4200]} />
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label"><Icon.Mail style={{ width: 13, height: 13 }} /> Email subscribers</div>
          <div className="stat-value">387<span style={{ fontSize: 14, color: 'var(--text-mute)', fontWeight: 400, marginLeft: 6 }}>total</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
            <span className="stat-delta"><Icon.ArrowUp style={{ width: 11, height: 11 }} />+42 this wk</span>
            <Sparkline data={[280, 295, 310, 325, 345, 365, 387]} />
          </div>
        </div>
      </div>

      <div className="dash-grid">
        <div className="plan-card">
          <div className="plan-card-hd">
            <div style={{ flex: 1 }}>
              <h2 className="plan-card-title">This week's actions</h2>
              <div className="plan-card-sub">May 19 – 25 · Focus: weekend visibility</div>
              <div className="plan-progress">
                <div className="plan-progress-bar">
                  <div className="plan-progress-fill" style={{ width: pct + '%' }} />
                </div>
                <div className="plan-progress-meta">
                  <span>{completed} OF {tasks.length} COMPLETE</span>
                  <span>{pct}%</span>
                </div>
              </div>
            </div>
          </div>
          <div className="weekly-list">
            {tasks.map(t => {
              const ch = CHANNELS[t.channel];
              return (
                <div
                  key={t.id}
                  className={`weekly-row${t.done ? ' done' : ''}`}
                  onClick={() => toggle(t.id)}
                >
                  <div className={`checkbox${t.done ? ' checked' : ''}`} />
                  <div>
                    <div className="weekly-title">{t.title}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                      <span className="tl-channel-tag" style={{ '--ch': ch.color }}>{ch.label}</span>
                      <span className="weekly-meta" style={{ color: 'var(--text-faint)' }}>·</span>
                      <span className="weekly-meta">{t.day}</span>
                    </div>
                  </div>
                  <div className="weekly-meta">{t.time}</div>
                  <Icon.ArrowRight style={{ width: 14, height: 14, color: 'var(--text-faint)' }} />
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-5)' }}>
          <div className="insight-card">
            <div className="insight-hd">
              <Icon.Sparkle style={{ width: 14, height: 14, color: 'var(--accent)' }} />
              <span className="h-eyebrow" style={{ color: 'var(--accent)' }}>HUNDRES NOTICED</span>
            </div>
            <div className="insight-body">
              Your Tuesday Reels are getting <strong style={{ color: 'var(--text)' }}>4.8× more saves</strong> than your feed posts. Want me to draft three more in that format for next week?
            </div>
            <div className="insight-actions">
              <button className="btn btn-primary" style={{ height: 28, fontSize: 12 }}>Draft three Reels</button>
              <button className="btn btn-ghost" style={{ height: 28, fontSize: 12 }}>Not now</button>
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 className="h-md">Upcoming this week</h3>
              <Icon.Calendar style={{ width: 14, height: 14, color: 'var(--text-mute)' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { day: 'TUE', date: 'May 20', what: 'Reel: behind the croissant', t: '8:00 AM' },
                { day: 'WED', date: 'May 21', what: 'Email: weekend special', t: '10:00 AM' },
                { day: 'FRI', date: 'May 23', what: 'Post: weekend preview', t: '5:00 PM' },
                { day: 'SAT', date: 'May 24', what: 'Story: Saturday lineup', t: '7:30 AM' },
              ].map((e, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '6px 0', borderBottom: i < 3 ? '1px solid var(--border)' : 'none', paddingBottom: i < 3 ? 12 : 0 }}>
                  <div style={{ width: 38, textAlign: 'center', flexShrink: 0 }}>
                    <div className="t-mono" style={{ fontSize: 10.5, color: 'var(--text-mute)', letterSpacing: '0.05em' }}>{e.day}</div>
                    <div style={{ fontSize: 16, fontWeight: 500, letterSpacing: '-0.02em', marginTop: 2 }}>{e.date.split(' ')[1]}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 450 }}>{e.what}</div>
                    <div className="t-mono" style={{ fontSize: 10.5, color: 'var(--text-mute)', marginTop: 2 }}>{e.t}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { Dashboard });
