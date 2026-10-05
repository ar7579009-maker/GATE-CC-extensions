// External on purpose: the page CSP is script-src 'self', so an inline script is silently blocked.
document.body.dataset.platform = 'mobile';
// Wire bottom nav clicks → React
document.getElementById('botnav').addEventListener('click', e => {
  const btn = e.target.closest('[data-tab]');
  if (!btn) return;
  document.querySelectorAll('.botnav [data-tab]').forEach(b => {
    const on = b === btn;
    b.classList.toggle('on', on);
    b.querySelector('.ico-bar').style.display = on ? 'block' : 'none';
  });
  window.__gccSetTab?.(btn.dataset.tab);
});
