import React, { useState } from 'react';
import { Num } from './ui.js';
import { PLAN_DEF, planCfg } from './planner.js';

const TONE = { red: 'var(--red)', amber: 'var(--amber)' };
const STATUS = {
  green: ['var(--green)', 'On track'],
  amber: ['var(--amber)', 'Tight'],
  red: ['var(--red)', 'Off track'],
};
const Bar = ({ v, c = '' }) => <div className={`bar ${c}`}><i style={{ width: `${Math.max(0, Math.min(100, (v || 0) * 100))}%` }} /></div>;
const fh = (x) => (Math.round(x * 10) / 10).toString();
const sdy = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

function Item({ it, first, onRev }) {
  const col = it.done ? 'var(--green)' : TONE[it.tone] || 'var(--mute)';
  return (
    <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start', gap: 8, padding: '7px 0', borderTop: first ? 0 : '1px solid var(--line)' }}>
      <span style={{ color: col, width: 14, flexShrink: 0, textAlign: 'center' }} aria-hidden>{it.done ? '✓' : '○'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className={it.done ? 'mute' : ''} style={it.done ? { textDecoration: 'line-through' } : TONE[it.tone] ? { color: TONE[it.tone] } : undefined}>{it.label}</div>
        {it.detail && <div className="mute small">{it.detail}</div>}
      </div>
      {it.rk && onRev ? <button className="btn sm ghost" onClick={() => onRev(it.rk, it.ri)}>Done</button>
        : it.est > 0 && !it.done && <span className="mute small" style={{ flexShrink: 0 }}>{fh(it.est)} h</span>}
    </div>
  );
}

function Verdict({ P, s, set }) {
  const H = P.horizon, [col, label] = STATUS[H.status];
  const skipped = s.subjects.filter((x) => (s.plan?.skip || {})[x.id]);
  const act = (o) => {
    if (o.kind === 'skip') set('plan', (p) => ({ ...PLAN_DEF, ...(p || {}), skip: { ...((p && p.skip) || {}), [o.subId]: true } }));
    else if (o.kind === 'move') set('targetDate', o.date);
  };
  const done = H.remainingLectures === 0;
  return (
    <div className="card" style={{ borderColor: col }}>
      <div className="row sb" style={{ flexWrap: 'nowrap', alignItems: 'baseline' }}>
        <h3 style={{ margin: 0, color: col }}>{label} for {sdy(H.targetDate)}</h3>
        <span className="mute small">{H.daysLeft} days left</span>
      </div>
      {done
        ? <div style={{ marginTop: 8 }}>Every lecture before the target date is ticked. Spend the time on PYQs and tests.</div>
        : H.needPerDay == null
          ? <div style={{ marginTop: 8 }}>The target date has passed with {H.remainingLectures} lectures left. Move the date or skip subjects below.</div>
          : <>
            <div className="row" style={{ gap: 20, marginTop: 8 }}>
              <div><div className="num" style={{ color: col }}>{fh(H.needPerDay)}<span className="mute small"> h/day</span></div><div className="mute small">needed</div></div>
              <div><div className="num">{fh(H.actual7)}<span className="mute small"> h/day</span></div><div className="mute small">last 7 days</div></div>
              <div><div className="num">{fh(H.goalH)}<span className="mute small"> h/day</span></div><div className="mute small">your goal</div></div>
            </div>
            <div className="mute small" style={{ marginTop: 8 }}>
              {H.remainingLectures} lectures left, about {fh(H.remainingHours)} h with DPP, PYQs and revision, over {H.workDays} study days.
              {H.missedLive > 0 && <> {H.missedLive} live lectures were missed.</>}
            </div>
          </>}
      {H.status !== 'green' && H.options.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="small" style={{ fontWeight: 600, marginBottom: 2 }}>To close the gap, pick one:</div>
          {H.options.map((o) => (
            <div key={o.id} className="row sb small" style={{ flexWrap: 'nowrap', padding: '5px 0', borderTop: '1px solid var(--line)' }}>
              <span style={{ minWidth: 0 }}>{o.label}{o.kind === 'skip' && <span className="mute"> · saves {fh(o.saves)} h, puts about {fh(o.marksPct)}% of exam marks at risk</span>}</span>
              {o.kind !== 'raise' && <button className="btn sm ghost" onClick={() => act(o)}>{o.kind === 'skip' ? 'Skip' : 'Move'}</button>}
            </div>
          ))}
        </div>
      )}
      {skipped.length > 0 && (
        <div className="small mute" style={{ marginTop: 10 }}>
          Skipped: {skipped.map((x, i) => <span key={x.id}>{i ? ', ' : ''}{x.name} <button className="ink" onClick={() => set('plan', (p) => { const k = { ...(p?.skip || {}) }; delete k[x.id]; return { ...PLAN_DEF, ...(p || {}), skip: k }; })}>restore</button></span>)}
        </div>
      )}
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

export function PlanView({ P, s, set }) {
  const [tab, setTab] = useState('week');
  const revDone = (key, i) => set('revq', (a) => a.map((r) => (r.key === key ? { ...r, done: r.done.map((d, j) => (j === i ? true : d)) } : r)));
  const T = P.today, E = P.exam, left = T.items.filter((i) => !i.done).length;
  const tabs = [['week', 'This week'], ['month', 'This month'], ['exam', 'Until exam']];
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
      {T.items.map((it, i) => <Item key={it.key} it={it} first={i === 0} onRev={revDone} />)}
      {T.over.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary className="small mute" style={{ cursor: 'pointer' }}>{T.over.length} more over today's {fh(T.capH)} h cap</summary>
          {T.over.map((it, i) => <Item key={it.key} it={it} first={i === 0} onRev={revDone} />)}
        </details>
      )}
      <div className="dim small" style={{ marginTop: 6 }}>Items tick themselves from your timer, lecture ticks and logged tests.</div>
    </div>
    <Verdict P={P} s={s} set={set} />
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
