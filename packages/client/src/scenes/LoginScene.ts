import Phaser from 'phaser';
import { login, register } from '../services/api-client.js';
import { getToken, saveSession } from '../services/auth-storage.js';

/**
 * Login/registration screen. Rendered entirely in the DOM overlay rather than in
 * Phaser: real inputs give us the native keyboard on mobile (and inside Capacitor
 * later), and keeping the title in the same layout as the form means they can
 * never collide. Drawing the title on the canvas instead puts it in the
 * letterboxed 1280x720 design space, which on a phone shrinks to a band in the
 * middle of the screen — exactly where the form sits.
 *
 * Phaser only paints the felt background here.
 */
export class LoginScene extends Phaser.Scene {
  private overlay!: HTMLElement;

  constructor() {
    super('LoginScene');
  }

  create(): void {
    // Already signed in from a previous visit — go straight to the lobby.
    if (getToken()) {
      this.scene.start('LobbyScene');
      return;
    }

    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, 0x0b3d2e).setOrigin(0);

    this.overlay = document.getElementById('ui-overlay') as HTMLElement;
    this.overlay.innerHTML = this.formHtml();
    this.overlay.classList.add('active');
    this.bindForm();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.overlay.classList.remove('active');
      this.overlay.innerHTML = '';
    });
  }

  private formHtml(): string {
    return `
      <div class="screen">
        <h1 class="brand">POKER</h1>
        <form id="auth-form" class="card">
          <div class="mode-switch" role="group" aria-label="Entrar ou criar conta">
            <button type="button" class="mode-btn" data-mode="login" aria-pressed="true">Entrar</button>
            <button type="button" class="mode-btn" data-mode="register" aria-pressed="false">Criar conta</button>
          </div>
          <input name="username" placeholder="Usuário" autocomplete="username"
                 autocapitalize="none" autocorrect="off" aria-label="Usuário" />
          <input name="email" type="email" placeholder="E-mail" autocomplete="email"
                 autocapitalize="none" autocorrect="off" aria-label="E-mail" hidden />
          <input name="password" type="password" placeholder="Senha"
                 autocomplete="current-password" aria-label="Senha" />
          <button type="submit" class="submit-btn">Entrar</button>
          <p id="auth-error" class="form-error" role="alert"></p>
        </form>
      </div>
    `;
  }

  private bindForm(): void {
    const form = this.overlay.querySelector<HTMLFormElement>('#auth-form')!;
    const emailInput = form.querySelector<HTMLInputElement>('input[name="email"]')!;
    const passwordInput = form.querySelector<HTMLInputElement>('input[name="password"]')!;
    const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const errorText = form.querySelector<HTMLParagraphElement>('#auth-error')!;
    let mode: 'login' | 'register' = 'login';

    const modeButtons = form.querySelectorAll<HTMLButtonElement>('.mode-btn');
    modeButtons.forEach((button) => {
      button.addEventListener('click', () => {
        mode = button.dataset.mode as 'login' | 'register';
        const registering = mode === 'register';

        emailInput.hidden = !registering;
        emailInput.required = registering;
        submitButton.textContent = registering ? 'Criar conta' : 'Entrar';
        // Tells the password manager to offer a new password instead of a saved one.
        passwordInput.autocomplete = registering ? 'new-password' : 'current-password';
        errorText.textContent = '';

        modeButtons.forEach((other) =>
          other.setAttribute('aria-pressed', String(other.dataset.mode === mode)),
        );
      });
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorText.textContent = '';
      submitButton.disabled = true;

      const data = new FormData(form);
      const username = String(data.get('username') ?? '').trim();
      const password = String(data.get('password') ?? '');
      const email = String(data.get('email') ?? '').trim();

      try {
        const result =
          mode === 'register'
            ? await register({ username, email, password })
            : await login({ username, password });
        saveSession(result.token, result.user);
        this.scene.start('LobbyScene');
      } catch (error) {
        errorText.textContent = error instanceof Error ? error.message : 'Falha na autenticação';
        submitButton.disabled = false;
      }
    });
  }
}
