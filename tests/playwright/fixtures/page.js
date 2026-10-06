// Minimal page-side editor contract, not a replacement for extension logic.
// No shortcut settings, composer selection, visibility or submitter safety logic here.
window.__submitCount = 0;
window.__newlineCount = 0;
window.__unhandledKeys = [];
let composing = false;
document.addEventListener('compositionstart', () => { composing = true; });
document.addEventListener('compositionend', () => { composing = false; });
document.querySelectorAll('button[type="submit"]').forEach(button => {
  button.addEventListener('click', event => {
    event.preventDefault();
    window.__submitCount++;
  });
});
document.querySelectorAll('form').forEach(form =>
  form.addEventListener('submit', event => event.preventDefault()));
document.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || !event.target.isContentEditable) return;
  window.__unhandledKeys.push({
    shift: event.shiftKey, ctrl: event.ctrlKey, meta: event.metaKey,
    trusted: event.isTrusted,
  });
  // The host editor also leaves composition keys to IME; no actual OS IME is simulated.
  if (composing || event.isComposing || event.keyCode === 229) return;
  // Like an editor handler, consume Shift+Enter and perform the requested edit.
  // This is necessary because synthetic key events have no native editing default.
  if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    document.execCommand('insertLineBreak');
    window.__newlineCount++;
  } else if (!event.shiftKey && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    // Model the page's default plain-Enter send, making a missing extension detectable.
    event.target.closest('form')?.querySelector('button[type="submit"]')?.click();
  }
  // Deliberately ignore synthetic Meta+Enter: reproduces the historical broken send path.
});
