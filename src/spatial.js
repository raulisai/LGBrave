// Spatial navigation for the TV remote: arrows move to the nearest control in
// that direction instead of following DOM order.
const FOCUSABLE = 'button:not([disabled]),input,[tabindex="0"]';

export function focusables(scope = document) {
  return [...scope.querySelectorAll(FOCUSABLE)].filter(element => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden';
  });
}

export function moveFocus(direction, from = document.activeElement, scope = document) {
  const items = focusables(scope);
  if (!items.length) return null;
  if (!from || !items.includes(from)) { items[0].focus(); return items[0]; }
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  const horizontal = direction === 'left' || direction === 'right';
  const forward = direction === 'right' || direction === 'down';
  let best = null;
  let bestScore = Infinity;
  for (const item of items) {
    if (item === from) continue;
    const b = item.getBoundingClientRect();
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    const delta = horizontal ? bx - ax : by - ay;
    if (forward ? delta <= 1 : delta >= -1) continue;
    const gap = horizontal ? (forward ? b.left - a.right : a.left - b.right) : (forward ? b.top - a.bottom : a.top - b.bottom);
    const overlap = horizontal ? Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) : Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const offset = horizontal ? Math.abs(by - ay) : Math.abs(bx - ax);
    const score = Math.max(0, gap) + (overlap > 0 ? offset * 0.3 : offset) * 2;
    if (score < bestScore) { bestScore = score; best = item; }
  }
  best?.focus();
  return best;
}
