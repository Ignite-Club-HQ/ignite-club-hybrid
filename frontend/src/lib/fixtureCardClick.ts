/**
 * Fixture card tap-to-open guard: ignore taps on admin controls (buttons,
 * links, inputs, menu items) and on anything outside the card's own DOM
 * (portal'd dialogs/menus bubble through the React tree).
 */
export function shouldIgnoreFixtureCardClick(card: Element, target: Element | null): boolean {
  if (!target || !card.contains(target)) return true;
  return !!target.closest('button, a, input, textarea, select, [role="menuitem"]');
}
