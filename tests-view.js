// Tests tab: kind + status for the full list. Pure.
export const KINDS = [['weekly', 'Weekly'], ['twt', 'TWT'], ['swt', 'SWT'], ['mst', 'MST'], ['gbg', 'GBG'], ['pyq', 'PYQ'], ['mock', 'Mock']];
export const STATUSES = [['attempted', 'Attempted'], ['missed', 'Missed'], ['upcoming', 'Upcoming']];
const nn = (x) => String(x || '').toLowerCase().replace(/[:·]/g, ' ').replace(/\s+/g, ' ').trim();
export function kindOf(t) {
  if (t.kind) return t.kind;
  const n = nn(t.name);
  if (/weekly/.test(n)) return 'weekly';
  if (/\btwt\b|topic ?wise/.test(n)) return 'twt';
  if (/\bswt\b|subject ?wise/.test(n)) return 'swt';
  if (/\bmst\b|multi/.test(n)) return 'mst';
  if (/\bgbg\b|grand/.test(n)) return 'gbg';
  if (/\bpyq\b|previous year/.test(n)) return 'pyq';
  if (/\bmock\b/.test(n)) return 'mock';
  return 'other';
}
export function resultFor(t, mocks) {
  const n = nn(t.name);
  return (mocks || []).filter((m) => m.test === t.id || (n && nn(m.name) === n)).slice(-1)[0] || null;
}
export function statusOf(t, mocks, today) {
  if (resultFor(t, mocks)) return 'attempted';
  return t.date && t.date < today ? 'missed' : 'upcoming';
}
export function filterTests(tests, mocks, today, { kind = 'all', status = 'all' } = {}) {
  return (tests || [])
    .map((t) => ({ t, kind: kindOf(t), status: statusOf(t, mocks, today), res: resultFor(t, mocks) }))
    .filter((r) => (kind === 'all' || r.kind === kind) && (status === 'all' || r.status === status))
    .sort((a, b) => (a.t.date || '9999').localeCompare(b.t.date || '9999') || String(a.t.name).localeCompare(String(b.t.name)));
}
export const countBy = (tests, mocks, today) => {
  const c = { attempted: 0, missed: 0, upcoming: 0 };
  (tests || []).forEach((t) => { c[statusOf(t, mocks, today)]++; });
  return c;
};
