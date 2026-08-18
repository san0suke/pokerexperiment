import Phaser from 'phaser';
import { login, register } from '../services/api-client.js';
import { getToken, saveSession } from '../services/auth-storage.js';

/**
 * Login/registration form. Uses a DOM overlay rather than Phaser text inputs —
 * it gives us native keyboards on mobile once this is wrapped by Capacitor.
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
    this.add
      .text(width / 2, height / 2 - 180, 'POKER', {
        fontSize: '64px',
        fontStyle: 'bold',
        color: '#f5d47a',
      })
      .setOrigin(0.5);

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
      <form id="auth-form" style="
        display:flex;flex-direction:column;gap:12px;width:320px;padding:28px;
        background:rgba(0,0,0,0.55);border-radius:12px;color:#fff;margin-top:120px;">
        <div style="display:flex;gap:8px;">
          <button type="button" data-mode="login" class="mode-btn" style="flex:1;padding:8px;">Entrar</button>
          <button type="button" data-mode="register" class="mode-btn" style="flex:1;padding:8px;">Criar conta</button>
        </div>
        <input name="username" placeholder="Usuário" autocomplete="username" style="padding:10px;" />
        <input name="email" placeholder="E-mail" autocomplete="email" style="padding:10px;display:none;" />
        <input name="password" type="password" placeholder="Senha" autocomplete="current-password" style="padding:10px;" />
        <button type="submit" style="padding:12px;background:#f5d47a;border:0;font-weight:bold;cursor:pointer;">
          Entrar
        </button>
        <p id="auth-error" style="color:#ff8a80;margin:0;min-height:18px;font-size:13px;"></p>
      </form>
    `;
  }

  private bindForm(): void {
    const form = this.overlay.querySelector<HTMLFormElement>('#auth-form')!;
    const emailInput = form.querySelector<HTMLInputElement>('input[name="email"]')!;
    const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const errorText = form.querySelector<HTMLParagraphElement>('#auth-error')!;
    let mode: 'login' | 'register' = 'login';

    form.querySelectorAll<HTMLButtonElement>('.mode-btn').forEach((button) => {
      button.addEventListener('click', () => {
        mode = button.dataset.mode as 'login' | 'register';
        emailInput.style.display = mode === 'register' ? 'block' : 'none';
        submitButton.textContent = mode === 'register' ? 'Criar conta' : 'Entrar';
        errorText.textContent = '';
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
