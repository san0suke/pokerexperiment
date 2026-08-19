import type { PublicUser } from '@poker/shared';

const TOKEN_KEY = 'poker.token';
const USER_KEY = 'poker.user';

export function saveSession(token: string, user: PublicUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): PublicUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as PublicUser;
  } catch {
    return null;
  }
}

/**
 * Atualiza só o saldo guardado. O servidor manda o número novo a cada mão que
 * fecha; sem isto o lobby continuaria mostrando o saldo do login até o próximo
 * login, e o jogador veria fichas que não tem mais.
 */
export function saveChips(chips: number): void {
  const user = getUser();
  if (!user) {
    return;
  }
  localStorage.setItem(USER_KEY, JSON.stringify({ ...user, chips }));
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
