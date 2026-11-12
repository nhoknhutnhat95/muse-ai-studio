// Apply saved appearance before CSS paints. No network or account state involved.
try {
  document.documentElement.dataset.theme = localStorage.getItem('muse-theme') === 'dark' ? 'dark' : 'light';
  document.documentElement.classList.toggle('nav-collapsed', localStorage.getItem('muse-nav-collapsed') === 'true');
} catch { document.documentElement.dataset.theme = 'light'; }
