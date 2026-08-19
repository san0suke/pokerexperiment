import type Phaser from 'phaser';

/**
 * Corta o texto com reticências até caber na largura pedida.
 *
 * No celular em pé sobra pouca largura para o nome da mesa; deixar quebrar em
 * duas linhas desalinha a linha de baixo da fila, então preferimos encurtar.
 */
export function fitText(text: Phaser.GameObjects.Text, maxWidth: number): void {
  if (maxWidth <= 0 || text.width <= maxWidth) {
    return;
  }

  const original = text.text;
  let length = original.length;

  while (length > 1 && text.width > maxWidth) {
    length -= 1;
    text.setText(`${original.slice(0, length).trimEnd()}…`);
  }
}
