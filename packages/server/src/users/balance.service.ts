import { prisma } from '../db/prisma.js';

/**
 * Saldo com que toda conta nasce. Espelha o `@default(1000)` do `User` no
 * Postgres — quem cria a conta já recebe essas fichas sem passar por aqui; o
 * valor fica escrito para o servidor ter como responder "quanto vale uma conta
 * nova" sem consultar o banco.
 */
export const STARTING_CHIPS = 1000;

/**
 * Saldo da conta. É ele que vira o stack quando o jogador senta: não existe mais
 * buy-in fixo por mesa, então perder fichas na mesa é perder fichas na conta.
 *
 * `null` quando a conta sumiu do banco — o JWT continua válido por horas depois
 * de o usuário deixar de existir, e sentar com saldo inventado seria pior.
 */
export async function readBalance(userId: string): Promise<number | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { chips: true },
  });
  return user ? Number(user.chips) : null;
}

/**
 * Grava o stack de volta na conta. Chamado ao fim de cada mão e quando o jogador
 * levanta da mesa — os dois momentos em que o stack é um número fechado.
 *
 * No meio da mão o banco continua com o saldo de antes dela, de propósito: o que
 * está no pote ainda não é de ninguém, e um servidor que caia agora devolve a
 * todos o que tinham quando a mão começou.
 */
export async function writeBalance(userId: string, chips: number): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { chips: BigInt(Math.max(0, Math.trunc(chips))) },
  });
}
