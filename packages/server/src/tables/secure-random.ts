import { randomInt } from 'node:crypto';

const RESOLUTION = 2 ** 32;

/**
 * RNG uniforme em [0, 1) apoiado no CSPRNG do Node.
 *
 * `Math.random` é previsível a partir de saídas observadas, e num jogo de cartas
 * isso é o mesmo que entregar o baralho. `Deck.shuffle()` aceita este `random`
 * justamente para o servidor injetar aqui a fonte criptográfica.
 */
export function secureRandom(): number {
  return randomInt(RESOLUTION) / RESOLUTION;
}
