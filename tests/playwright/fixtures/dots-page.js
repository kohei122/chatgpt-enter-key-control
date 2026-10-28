// Mock page behavior only. Real Dots Shift+Enter compatibility remains unverified.
window.__otherClicks = 0;
window.__clickedComposers = [];
// Observed empty/nonempty availability, modeled without real application code.
document.addEventListener('input', event => {
  const footer = event.target.closest('[data-composer-footer-responsive]');
  const button = footer?.querySelector('[data-testid="send"]');
  if (!button) return;
  button.disabled = !event.target.textContent.trim();
  if (button.disabled) button.setAttribute('aria-disabled', 'true');
  else button.removeAttribute('aria-disabled');
});
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.testid === 'send') {
    window.__submitCount++;
    window.__clickedComposers.push(button.closest('[data-composer-footer-responsive]')?.id || 'primary');
  }
  else window.__otherClicks++;
});
document.addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.isTrusted && event.target.isContentEditable &&
      !event.shiftKey && !event.ctrlKey && !event.metaKey &&
      !event.isComposing && event.keyCode !== 229 && !composing.has(event.target)) {
    document.querySelector('[data-testid="send"]')?.click();
  }
});
