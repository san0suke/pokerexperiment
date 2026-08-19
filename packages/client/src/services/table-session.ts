const TABLE_KEY = 'poker.table';

/**
 * Guarda em que mesa o jogador está, para uma recarga da página devolvê-lo a ela
 * em vez de ao lobby.
 *
 * O celular descarta a página quando o app passa muito tempo em segundo plano:
 * ao voltar, ela é carregada do zero, com o assento e as fichas ainda de pé no
 * servidor. Sem esta memória o jogador reaparece no lobby e precisa procurar a
 * própria mesa — quando ainda dá tempo.
 *
 * `sessionStorage`, e não `localStorage`: vale para esta aba enquanto ela viver.
 * Amanhã ninguém quer ser jogado dentro de uma mesa que fechou faz tempo.
 */
export function rememberTable(tableId: string): void {
  sessionStorage.setItem(TABLE_KEY, tableId);
}

export function forgetTable(): void {
  sessionStorage.removeItem(TABLE_KEY);
}

export function getRememberedTable(): string | null {
  return sessionStorage.getItem(TABLE_KEY);
}
