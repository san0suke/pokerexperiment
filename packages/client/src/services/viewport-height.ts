/**
 * Keeps `--app-height` in sync with the area the player can actually see, and
 * marca `<html>` com `short-viewport` quando sobra pouca tela.
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
 *
 * A classe existe pela mesma razão: `@media (max-height: ...)` resolve contra o
 * viewport de layout, que no iOS **não** encolhe quando o teclado abre. Uma
 * regra de CSS não enxerga o teclado, então quem decide é esta medida.
 */

/**
 * Abaixo desta altura visível (em pixels de CSS) a tela é um celular com o
 * teclado aberto, ou um aparelho deitado: o que estiver só enfeitando — a logo
 * do login — precisa sair para o formulário caber sem rolagem. Um celular em pé
 * sem teclado tem 650px ou mais, mesmo os pequenos.
 */
const SHORT_VIEWPORT_HEIGHT = 560;

export function trackViewportHeight(): void {
  const visual = window.visualViewport;

  const apply = (): void => {
    const height = visual ? visual.height : window.innerHeight;
    const root = document.documentElement;
    root.style.setProperty('--app-height', `${Math.round(height)}px`);
    root.classList.toggle('short-viewport', height < SHORT_VIEWPORT_HEIGHT);
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
