// Run synchronously in the head to apply the saved theme before the first paint.
(() => {
  const storageKey = 'saudi-sectors-theme';
  const isTheme = value => value === 'dark' || value === 'light';
  let theme = 'dark';
  let buttons = [];

  try {
    const saved = window.localStorage.getItem(storageKey);
    if (isTheme(saved)) theme = saved;
  } catch {
    // Storage may be unavailable; switching themes still works for this page.
  }

  function applyTheme(value) {
    theme = value;
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f6f8' : '#11161d');
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button.dataset.themeOption === theme));
    }
  }

  applyTheme(theme);

  function initializeButtons() {
    buttons = document.querySelectorAll('[data-theme-option]');
    for (const button of buttons) {
      if (!isTheme(button.dataset.themeOption)) continue;
      button.addEventListener('click', () => {
        const value = button.dataset.themeOption;
        if (!isTheme(value)) return;
        applyTheme(value);
        try {
          window.localStorage.setItem(storageKey, value);
        } catch {
          // Keep the in-memory selection even when persistence is blocked.
        }
      });
    }
    // The theme-color meta and controls may not have existed during head execution.
    applyTheme(theme);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeButtons, { once: true });
  } else {
    initializeButtons();
  }

  window.addEventListener('storage', event => {
    if (event.key !== storageKey && event.key !== null) return;
    try {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
    } catch {
      return;
    }
    applyTheme(isTheme(event.newValue) ? event.newValue : 'dark');
  });
})();
