// Keep the original, sortable header aligned with its columns while the page
// scrolls. Horizontal scrolling remains native to the table wrapper (including RTL).
(() => {
  const sections = document.getElementById('sectors');
  if (!sections) return;

  let frame = 0;
  const observedHeaders = new Set();
  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(scheduleUpdate)
    : null;

  function updateHeaders() {
    frame = 0;
    const headers = sections.querySelectorAll('.table-wrap table > thead');
    const measurements = Array.from(headers, header => {
      const table = header.closest('table');
      const rect = table.getBoundingClientRect();
      const height = header.offsetHeight;
      // Stop at the final table row rather than floating over the next section.
      const offset = Math.max(0, Math.min(-rect.top, rect.height - height));
      return { header, offset };
    });

    for (const { header, offset } of measurements) {
      header.style.setProperty('--table-head-offset', `${offset}px`);
      if (resizeObserver && !observedHeaders.has(header)) {
        resizeObserver.observe(header);
        observedHeaders.add(header);
      }
    }
    for (const header of observedHeaders) {
      if (!header.isConnected) {
        resizeObserver.unobserve(header);
        observedHeaders.delete(header);
      }
    }
  }

  function scheduleUpdate() {
    if (!frame) frame = requestAnimationFrame(updateHeaders);
  }

  window.addEventListener('scroll', scheduleUpdate, { passive: true });
  window.addEventListener('resize', scheduleUpdate);
  window.visualViewport?.addEventListener('resize', scheduleUpdate);
  // Search, sorting, sector selection and automatic data refresh replace the table.
  new MutationObserver(scheduleUpdate).observe(sections, {
    childList: true,
    subtree: true,
    characterData: true
  });
  if (resizeObserver) resizeObserver.observe(document.getElementById('main-content'));
  document.fonts?.ready.then(scheduleUpdate);
  scheduleUpdate();
})();
