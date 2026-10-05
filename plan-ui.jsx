import React, { useState } from 'react';
import { Num, Inline } from './ui.js';
import { PLAN_DEF, planCfg, calcPace } from './planner.js';

const TONE = { red: 'var(--red)', amber: 'var(--amber)' };
const STATUS = {
  green: ['var(--green)', 'On track'],
  amber: ['var(--amber)', 'Tight'],
  red: ['var(--red)', 'Off track'],
};
const Bar = ({ v, c = '' }) => <div className={`bar ${c}`}><i style={{ width: `${Math.max(0, Math.min(100, (v || 0) * 100))}%` }} /></div>;
const fh = (x) => (Math.round(x * 10) / 10).toString();
const sdy = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

function Item({ it, first, onRev, pyq }) {
  const col = it.done ? 'var(--green)' : TONE[it.tone] || 'var(--mute)';
  return (
    <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start', gap: 8, padding: '7px 0', borderTop: first ? 0 : '1px solid var(--line)' }}>
      <span style={{ color: col, width: 14, flexShrink: 0, textAlign: 'center' }} aria-hidden>{it.done ? '✓' : '○'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className={it.done ? 'mute' : ''} style={it.done ? { textDecoration: 'line-through' } : TONE[it.tone] ? { color: TONE[it.tone] } : undefined}>{it.label}</div>
        {it.detail && <div className="mute small">{it.detail}</div>}
      </div>
      {it.kind === 'pyq' && pyq ? <span className="row" style={{ flexWrap: 'nowrap', gap: 6, flexShrink: 0 }}><button className="btn sm ghost" aria-label="One less" onClick={pyq.dec}>−</button><b style={{ minWidth: 22, textAlign: 'center' }}>{pyq.count}</b><button className="btn sm ghost" aria-label="One more" onClick={pyq.inc}>+</button></span>
        : it.rk && onRev ? <button className="btn sm ghost" onClick={() => onRev(it.rk, it.ri)}>Done</button>
        : it.est > 0 && !it.done && <span className="mute small" style={{ flexShrink: 0 }}>{fh(it.est)} h</span>}
    </div>
  );
}

export function Verdict({ P, s, set }) {
  const H = P.horizon, [col, label] = STATUS[H.status];
  const done = H.remainingLectures === 0, more = H.options.find((o) => o.kind === 'raise');
  return (
    <div className="card" style={{ borderColor: col }}>
      <div className="row sb" style={{ flexWrap: 'nowrap', alignItems: 'baseline' }}>
        <h3 style={{ margin: 0, color: col }}>{label} for {sdy(H.targetDate)}</h3>
        <span className="mute small">{H.daysLeft} days left</span>
      </div>
      {done
        ? <div style={{ marginTop: 8 }}>Every lecture before the target date is ticked. Spend the time on PYQs and tests.</div>
        : <>
          <div className="row" style={{ gap: 20, marginTop: 8 }}>
            <div><div className="num" style={{ color: col }}>{H.needPerDay == null ? '–' : fh(H.needPerDay)}<span className="mute small"> h/day</span></div><div className="mute small">needed</div></div>
            <div><div className="num">{fh(H.actual7)}<span className="mute small"> h/day</span></div><div className="mute small">last 7 days</div></div>
            <div><div className="num"><Inline min={1} max={16} value={H.goalH} onValue={(v) => set('goalH', v)} /><span className="mute small"> h/day</span></div><div className="mute small">your goal · tap to edit</div></div>
          </div>
          <div className="mute small" style={{ marginTop: 8 }}>
            {H.remainingLectures} lectures left, about {fh(H.remainingHours)} h with DPP, PYQs and revision, over {H.workDays} study days.
            {H.missedLive > 0 && <> {H.missedLive} live lectures were missed.</>}
          </div>
          {H.needPerDay == null && <div style={{ marginTop: 8 }}>The target date has passed with {H.remainingLectures} lectures left. The calculator below shows how long they take at your pace.</div>}
          {H.status !== 'green' && more && <div className="small" style={{ marginTop: 8, fontWeight: 600 }}>To close the gap: {more.label}.</div>}
        </>}
    </div>
  );
}

/* ── pace calculator: playback speed x hours per day x window -> finish date, days early/late, hours covered ── */
export function PaceCalc({ P, s, set, today }) {
  const H = P.horizon, [hrs, setHrs] = useState(null), [win, setWin] = useState(null);
  const speed = s.calcSpeed || 1, hPerDay = hrs ?? H.goalH, windowDays = win ?? Math.max(1, H.daysLeft);
  const r = calcPace({ total: H.remainingHours, video: H.videoHours, speed, hPerDay, windowDays, today, targetDate: H.targetDate, restDay: H.restDay, bufferPct: H.bufferPct });
  const early = r.daysEarly, lab = early == null ? 'never at this pace' : sdy(r.finish);
  const Cell = ({ k, v, sub, c }) => <div style={{ minWidth: 0 }}><div className="num" style={{ fontSize: 20, color: c }}>{v}</div><div className="mute small">{k}</div>{sub && <div className="dim small">{sub}</div>}</div>;
  return (
    <div className="card">
      <h3>Planner calculator</h3>
      <div className="row small mute" style={{ gap: 12, marginBottom: 10 }}>
        <label>Speed <select value={speed} onChange={(e) => set('calcSpeed', +e.target.value)}>{[1, 1.25, 1.5, 1.75, 2].map((x) => <option key={x} value={x}>{x}x</option>)}</select></label>
        <label>Hours/day <Num min={0.5} max={16} value={hPerDay} onValue={setHrs} style={{ width: 60 }} /></label>
        <label>Window <Num min={1} max={400} value={windowDays} onValue={setWin} style={{ width: 62 }} /> days</label>
      </div>
      <div className="grid" style={{ gap: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))' }}>
        <Cell k="hours left" v={`${fh(r.hours)} h`} sub={speed > 1 && H.videoHours > 0 ? `${fh(H.remainingHours - r.hours)} h saved by ${speed}x` : undefined} />
        <Cell k="finish date" v={lab} />
        <Cell k={early == null ? 'versus target' : early >= 0 ? 'days early' : 'days late'} v={early == null ? '–' : Math.abs(early)} c={early == null || early < 0 ? 'var(--red)' : 'var(--green)'} />
        <Cell k={`covered in ${windowDays} days`} v={`${fh(r.windowHours)} h`} sub="after the lost-days buffer" />
        <Cell k="needed to hit target" v={r.neededPerDay == null ? '–' : `${fh(r.neededPerDay)} h/day`} sub={`by ${sdy(H.targetDate)}`} />
      </div>
      <div className="dim small" style={{ marginTop: 8 }}>Speed shortens lecture video only; DPP, PYQs, notes and revision stay as estimated.{H.videoEstimated ? ' Lecture lengths are estimated until the PW sync fills them in.' : ''}</div>
    </div>
  );
}

function Span({ title, data, hours, extra }) {
  return (
    <div className="card">
      {hours && <div style={{ marginBottom: 8 }}>
        <div className="row sb small"><span>{title}</span><span className="mute">{fh(hours.done)} / {fh(hours.target)} h</span></div>
        <Bar v={hours.target ? hours.done / hours.target : 0} c={hours.target && hours.done >= hours.target ? 'g' : ''} />
      </div>}
      {data.length ? data.map((it, i) => <Item key={it.key} it={it} first={i === 0} />) : <div className="mute small">Nothing scheduled.</div>}
      {extra}
    </div>
  );
}

export function TodayList({ P, s, set, pyq }) {
  const revDone = (key, i) => set('revq', (a) => a.map((r) => (r.key === key ? { ...r, done: r.done.map((d, j) => (j === i ? true : d)) } : r)));
  const T = P.today, left = T.items.filter((i) => !i.done).length;
  return (<>
    {P.doNow && (
      <div className="card" style={{ borderColor: 'var(--amber)' }}>
        <div className="mute small">Do now</div>
        <div style={{ fontSize: 17, fontWeight: 600, marginTop: 2 }}>{P.doNow.label}</div>
        <div className="mute small">{P.doNow.detail}{P.doNow.est > 0 ? ` · about ${fh(P.doNow.est)} h` : ''}</div>
      </div>
    )}
    <div className="card">
      <div className="row sb"><h3 style={{ margin: 0 }}>Today</h3><span className="mute small">{left} left · about {fh(T.hours)} of {fh(T.capH)} h</span></div>
      {T.items.map((it, i) => <Item key={it.key} it={it} first={i === 0} onRev={revDone} pyq={pyq} />)}
      {T.over.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary className="small mute" style={{ cursor: 'pointer' }}>{T.over.length} more over today's {fh(T.capH)} h cap</summary>
          {T.over.map((it, i) => <Item key={it.key} it={it} first={i === 0} onRev={revDone} pyq={pyq} />)}
        </details>
      )}
      <div className="dim small" style={{ marginTop: 6 }}>Items tick themselves from your timer, lecture ticks and logged tests.</div>
    </div>
  </>);
}

export function PlanOutlook({ P }) {
  const [tab, setTab] = useState('week');
  const E = P.exam;
  const tabs = [['week', 'This week'], ['month', 'This month'], ['exam', 'Until exam']];
  return (<>
    <div className="row" style={{ gap: 6, margin: '4px 0 8px' }}>
      {tabs.map(([k, l]) => <button key={k} className={`chip ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
    </div>
    {tab === 'week' && <Span title="Hours this week" data={P.week.items} hours={P.week.hours} />}
    {tab === 'month' && <Span title="Hours this month" data={P.month.items} hours={P.month.hours} />}
    {tab === 'exam' && (
      <div className="card">
        <div className="row sb small"><span>GATE on {sdy(E.examDate)}</span><span className="mute">{E.daysLeft} days left</span></div>
        <div className="small" style={{ marginTop: 8 }}>Syllabus target {sdy(P.horizon.targetDate)}, then {E.revisionDays} days for revision, PYQs and tests only.</div>
        <div className="small" style={{ marginTop: 8 }}>Full-length tests attempted: <b>{E.testsDone}</b> of {E.testsTotal} scheduled before the exam.</div>
        <Bar v={E.testsTotal ? E.testsDone / E.testsTotal : 0} />
        {E.next.length > 0 && <div style={{ marginTop: 8 }}><div className="small mute">Next</div>{E.next.map((t) => <div key={t.name + t.date} className="row sb small" style={{ padding: '3px 0' }}><span>{t.name}</span><span className="mute">{sdy(t.date)}</span></div>)}</div>}
      </div>
    )}
  </>);
}

export function PlannerSettings({ s, set }) {
  const c = planCfg(s.plan), up = (k) => (v) => set('plan', (p) => ({ ...PLAN_DEF, ...(p || {}), skip: { ...((p && p.skip) || {}) }, [k]: v }));
  const row = (label, node, hint) => <label className="small mute" style={{ display: 'block' }}>{label} {node}{hint && <span className="dim"> {hint}</span>}</label>;
  return (
    <div className="card">
      <h3>Planner</h3>
      <div className="grid" style={{ gap: 10 }}>
        {row('Hours per lecture, with DPP and notes', <Num min={0.5} max={6} value={c.hPerLecture} onValue={up('hPerLecture')} style={{ width: 62 }} />, '(replaced by your measured pace after 5 lectures)')}
        {row('Lectures assumed per unannounced chapter', <Num min={1} max={15} value={c.plc} onValue={up('plc')} style={{ width: 62 }} />)}
        {row('Extra time for revision', <Num min={0} max={100} value={c.revPct} onValue={up('revPct')} style={{ width: 62 }} />, '%')}
        {row('Buffer for lost days', <Num min={0} max={50} value={c.bufferPct} onValue={up('bufferPct')} style={{ width: 62 }} />, '%')}
        {row('Longest realistic study day', <Num min={1} max={16} value={c.capH} onValue={up('capH')} style={{ width: 62 }} />, 'h')}
        {row('Weekly rest day', <select value={c.restDay} onChange={(e) => up('restDay')(+e.target.value)}><option value={-1}>None</option><option value={0}>Sunday</option><option value={6}>Saturday</option></select>)}
      </div>
    </div>
  );
}
