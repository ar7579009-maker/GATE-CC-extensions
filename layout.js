// Layout: which cards the user hid (device-local, NOT in SYNCED). Hiding only changes the display.
export const CARDS = {
  timer: 'Deep-work timer', calc: 'Planner calculator', deadline: 'Deadline',
  rules: 'Daily rules', outlook: 'Outlook', schedule: 'Schedule',
};
export const LOCKED = ['verdict', 'today'];
export const isLocked = (id) => LOCKED.includes(id);
export const cleanLayout = (l) => ({ hidden: [...new Set(Array.isArray(l?.hidden) ? l.hidden : [])].filter((id) => CARDS[id] && !isLocked(id)) });
export const isHidden = (l, id) => !isLocked(id) && cleanLayout(l).hidden.includes(id);
export const hideCard = (l, id) => (CARDS[id] && !isLocked(id) ? { hidden: [...cleanLayout(l).hidden.filter((x) => x !== id), id] } : cleanLayout(l));
export const restoreCard = (l, id) => ({ hidden: cleanLayout(l).hidden.filter((x) => x !== id) });
export const hiddenList = (l) => cleanLayout(l).hidden.map((id) => ({ id, name: CARDS[id] }));
