/** Remember geometry and ordinals, never Roon item keys. Reload the visible window on Back. */
export function captureListPosition(list, selector, base, selected) {
  if (!list) return { offset: 0, inset: 0, selected: 0 };
  var rows = list.querySelectorAll(selector), top = list.getBoundingClientRect().top;
  var first = 0, chosen = -1;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i] === selected) chosen = i;
    if (rows[i].getBoundingClientRect().bottom <= top) first = i + 1;
  }
  first = Math.min(first, Math.max(0, rows.length - 1));
  return { offset: base + first, inset: rows[first] ? rows[first].getBoundingClientRect().top - top : 0,
    selected: chosen < first ? 0 : chosen - first };
}
export function restoreListPosition(list, selector, position) {
  var rows = list.querySelectorAll(selector);
  if (!rows.length) return null;
  list.scrollTop += rows[0].getBoundingClientRect().top - list.getBoundingClientRect().top - position.inset;
  return rows[Math.max(0, Math.min(rows.length - 1, position.selected || 0))];
}
