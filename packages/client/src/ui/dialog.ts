import Phaser from 'phaser';
import { createButton } from './button.js';
import { dp, px, space, type Layout } from './layout.js';

export interface ModalMessageConfig {
  title: string;
  detail?: string;
  /** Saída opcional: aparece abaixo do texto. */
  action?: { label: string; onClick: () => void };
}

/**
 * Aviso centrado na tela, com a cena escurecida atrás.
 *
 * O retângulo escuro é interativo de propósito: é ele que engole o toque para
 * que os botões da cena atrás não respondam enquanto o aviso está de pé.
 *
 * Devolve um container já posicionado; quem chama só precisa adicioná-lo por
 * último, para ficar acima do resto.
 */
export function createModalMessage(
  scene: Phaser.Scene,
  layout: Layout,
  config: ModalMessageConfig,
): Phaser.GameObjects.Container {
  const { width, height, padX } = layout;
  const padding = space(layout, 22, 16);
  const gap = space(layout, 10, 8);
  const maxPanelWidth = Math.min(width - padX * 2, dp(layout, 420));
  const maxTextWidth = maxPanelWidth - padding * 2;

  const title = scene.add
    .text(0, 0, config.title, {
      fontSize: `${px(layout, 24, 17)}px`,
      fontStyle: 'bold',
      color: '#f5d47a',
      align: 'center',
      wordWrap: { width: maxTextWidth },
    })
    .setOrigin(0.5, 0);

  const detail = config.detail
    ? scene.add
        .text(0, 0, config.detail, {
          fontSize: `${px(layout, 15, 12)}px`,
          color: '#cfe8dd',
          align: 'center',
          lineSpacing: space(layout, 4, 3),
          wordWrap: { width: maxTextWidth },
        })
        .setOrigin(0.5, 0)
    : null;

  const action = config.action
    ? createButton(scene, {
        label: config.action.label,
        x: 0,
        y: 0,
        layout,
        fontSize: 16,
        anchorX: 0.5,
        onClick: config.action.onClick,
      })
    : null;

  const parts = [title, detail, action].filter(
    (part): part is Phaser.GameObjects.Text | Phaser.GameObjects.Container => part !== null,
  );
  const contentHeight =
    parts.reduce((sum, part) => sum + part.height, 0) + gap * (parts.length - 1);
  const contentWidth = Math.max(...parts.map((part) => part.width));

  const panelWidth = Math.min(maxPanelWidth, contentWidth + padding * 2);
  const panelHeight = contentHeight + padding * 2;
  const left = Math.round((width - panelWidth) / 2);
  const top = Math.round((height - panelHeight) / 2);

  const shade = scene.add
    .rectangle(0, 0, width, height, 0x02170f, 0.78)
    .setOrigin(0)
    .setInteractive();

  const panel = scene.add.graphics();
  panel.fillStyle(0x0f4a39, 1);
  panel.fillRoundedRect(left, top, panelWidth, panelHeight, dp(layout, 14));
  panel.lineStyle(dp(layout, 2), 0x2f8f6d, 1);
  panel.strokeRoundedRect(left, top, panelWidth, panelHeight, dp(layout, 14));

  let y = top + padding;
  for (const part of parts) {
    part.setPosition(width / 2, y);
    y += part.height + gap;
  }

  return scene.add.container(0, 0, [shade, panel, ...parts]);
}
