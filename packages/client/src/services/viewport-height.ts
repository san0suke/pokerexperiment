/**
 * Keeps `--app-height` in sync with the area the player can actually see.
 *
 * Mobile browsers report two different heights. The layout viewport (what `100%`
 * and `100vh` resolve to) is the height the page would have with the browser
 * chrome hidden; the visual viewport is what is really on screen right now, after
 * the address bar, toolbars and the on-screen keyboard take their share. Sizing a
 * scroll container against the layout viewport makes it taller than the screen:
 * the content fits that phantom height, so the browser reports nothing to scroll
 * while the bottom of the form sits behind the chrome, out of reach.
 *
 * `100dvh` solves this natively, but only on Safari 15.4+ / Chrome 108+, so this
 * measures `visualViewport` and feeds the real number into CSS. The CSS falls
 * back to dvh and then vh where this never runs.
 */
export function trackViewportHeight(): void {
  const visual = window.visualViewport;

  const apply = (): void => {
    const height = visual ? visual.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`);
  };

  apply();

  if (visual) {
    // Fires when chrome slides away and when the keyboard opens or closes.
    visual.addEventListener('resize', apply);
  }
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', () => {
    // Some browsers report the old size until after the rotation settles.
    apply();
    setTimeout(apply, 300);
  });
}
