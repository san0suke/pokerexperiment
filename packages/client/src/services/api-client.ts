import type { AuthResponse } from '@poker/shared';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((data as { message?: string }).message ?? 'Erro na requisição');
  }
  return data as T;
}

export function register(input: {
  username: string;
  email: string;
  password: string;
}): Promise<AuthResponse> {
  return post<AuthResponse>('/auth/register', input);
}

export function login(input: { username: string; password: string }): Promise<AuthResponse> {
  return post<AuthResponse>('/auth/login', input);
}
