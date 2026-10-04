import React, { useState, useEffect, useRef } from 'react';

// Number box that lets you clear and retype. Valid in-range values apply live; the value is clamped on blur.
export function Num({ value, onValue, min, max, style, autoFocus }) {
  const [t, setT] = useState(String(value ?? ''));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setT(String(value ?? '')); }, [value, focus]);
  const ok = (n) => Number.isFinite(n) && (min == null || n >= min) && (max == null || n <= max);
  return React.createElement('input', {
    type: 'number', min, max, style, value: t, autoFocus, onKeyDown: (e) => e.key === 'Enter' && e.target.blur(),
    onFocus: () => setFocus(true),
    onChange: (e) => { setT(e.target.value); const n = parseFloat(e.target.value); if (ok(n)) onValue(n); },
    onBlur: () => {
      setFocus(false);
      const n = parseFloat(t);
      if (!Number.isFinite(n)) { setT(String(value ?? '')); return; }
      const c = Math.min(max ?? n, Math.max(min ?? n, n));
      onValue(c); setT(String(c));
    },
  });
}

// Read-only value that turns into an input only when tapped (keeps screens clean, nothing gets edited by accident).
export function Inline({ value, onValue, min, max, unit = '' }) {
  const [on, setOn] = useState(false);
  return on ? <span onBlur={() => setOn(false)}><Num autoFocus min={min} max={max} value={value} onValue={onValue} style={{ width: 62 }} /></span>
    : <button type="button" className="ink" title="Tap to edit" onClick={() => setOn(true)}>{value}{unit}</button>;
}
export function InlineDate({ value, onChange, fmt }) {
  const ref = useRef(null);
  const pick = () => { const i = ref.current; if (!i) return; try { i.showPicker(); } catch { i.focus(); i.click(); } };
  return <button type="button" className="ink" title="Tap to change" onClick={pick}>{fmt ? fmt(value) : value}
    <input ref={ref} type="date" value={value} tabIndex={-1} onChange={(e) => e.target.value && onChange(e.target.value)} style={{ position: 'absolute', left: 0, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} /></button>;
}
