// External on purpose: the page CSP is script-src 'self', so an inline script is silently blocked.
// Mark platform so App.jsx can detect it
document.body.dataset.platform = 'win';
// Wire sidebar tab clicks → send to React
document.getElementById('sidenav').addEventListener('click', e => {
  const btn = e.target.closest('[data-tab]');
  if (!btn) return;
  document.querySelectorAll('.sidenav [data-tab]').forEach(b => b.classList.toggle('on', b === btn));
  window.__gccSetTab?.(btn.dataset.tab);
});
