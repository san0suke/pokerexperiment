import Phaser from 'phaser';
import type { LobbyTableSummary } from '@poker/shared';
import { getSocket, disconnectSocket, type PokerClientSocket } from '../services/socket-client.js';
import { clearSession, getUser } from '../services/auth-storage.js';
import { forgetTable } from '../services/table-session.js';
import { createButton } from '../ui/button.js';
import { readLayout, dp, px, space, type Layout } from '../ui/layout.js';
import { fitText } from '../ui/text.js';

/**
 * Largura máxima da lista, em pixels de CSS: em telas largas as filas não viram
 * faixas gigantes. Como toda medida crua, passa por `dp()` antes de ser usada.
 */
const MAX_LIST_WIDTH = 760;
/** Arrasto maior que isso (em pixels de CSS) é rolagem, não toque numa mesa. */
const DRAG_THRESHOLD = 10;

/**
 * Lista de mesas. Todo o desenho é refeito a partir das medidas reais da tela
 * (`readLayout`), então o mesmo código serve para o celular em pé, deitado e para
 * o desktop — e é refeito de novo a cada giro do aparelho.
 *
 * A lista rola por arrasto: no celular deitado cabem duas ou três mesas na altura
 * visível, e sem rolagem as demais ficariam inalcançáveis.
 */
export class LobbyScene extends Phaser.Scene {
  private layout!: Layout;
  private tables: LobbyTableSummary[] = [];
  private connectionError = '';

  private root!: Phaser.GameObjects.Container;
  private list!: Phaser.GameObjects.Container;
  private listMask?: Phaser.GameObjects.Graphics;
  private scrollbar?: Phaser.GameObjects.Graphics;

  private listTop = 0;
  private listLeft = 0;
  private listWidth = 0;
  private listHeight = 0;
  private scrollTop = 0;
  private maxScroll = 0;

  private dragging = false;
  private dragStartY = 0;
  private dragStartScroll = 0;
  private dragDistance = 0;

  constructor() {
    super('LobbyScene');
  }

  create(): void {
    this.build();
    this.bindScrolling();

    const socket = getSocket();

    socket.on('connect_error', (error) => {
      // A rejected handshake almost always means the token expired.
      this.connectionError = `Erro de conexão: ${error.message}`;
      this.build();
    });

    socket.on('lobby:tables-updated', (tables) => this.setTables(tables));

    // A lista só chega por broadcast quando algo muda: depois de uma queda ela
    // ficaria parada no que era antes até alguém sentar ou sair de alguma mesa.
    socket.on('connect', () => {
      this.connectionError = '';
      this.requestTables(socket);
    });

    this.requestTables(socket);

    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      socket.off('lobby:tables-updated');
      socket.off('connect_error');
      socket.off('connect');
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    });
  }

  private handleResize(): void {
    this.build();
  }

  private requestTables(socket: PokerClientSocket): void {
    socket.emit('lobby:list-tables', (tables) => this.setTables(tables));
  }

  private setTables(tables: LobbyTableSummary[]): void {
    this.tables = tables;
    this.build();
  }

  /** Redesenha a tela inteira com as medidas atuais. */
  private build(): void {
    this.layout = readLayout(this.scale);

    this.root?.destroy(true);
    this.list?.destroy(true);
    this.listMask?.destroy();
    this.scrollbar?.destroy();
    this.listMask = undefined;
    this.scrollbar = undefined;

    this.root = this.add.container(0, 0);

    const headerBottom = this.buildHeader();
    this.buildList(headerBottom + space(this.layout, 20, 14));
  }

  /** Desenha o cabeçalho e devolve a altura ocupada por ele. */
  private buildHeader(): number {
    const { width, padX, padTop, portrait } = this.layout;
    const user = getUser();

    const title = this.add
      .text(padX, padTop, 'LOBBY', {
        fontSize: `${px(this.layout, 40, 26)}px`,
        fontStyle: 'bold',
        color: '#f5d47a',
      })
      .setOrigin(0, 0);

    const logout = createButton(this, {
      label: 'Sair',
      x: width - padX,
      y: padTop,
      layout: this.layout,
      fontSize: 16,
      anchorX: 1,
      onClick: () => {
        disconnectSocket();
        clearSession();
        forgetTable();
        this.scene.start('LoginScene');
      },
    });

    const chips = user?.chips ?? 0;
    const subtitle = this.add
      .text(
        padX,
        title.y + title.height + space(this.layout, 8, 6),
        `${user?.username ?? '?'} — ${chips} fichas`,
        { fontSize: `${px(this.layout, 18, 13)}px`, color: '#cfe8dd' },
      )
      .setOrigin(0, 0);

    // Em pé o botão desce até a altura da segunda linha do cabeçalho, então o
    // texto do usuário só pode ocupar a largura que sobra ao lado dele.
    fitText(subtitle, width - padX * 2 - (portrait ? logout.width + space(this.layout, 12, 8) : 0));

    this.root.add([title, subtitle, logout]);

    let bottom = Math.max(subtitle.y + subtitle.height, padTop + logout.height);

    if (this.connectionError) {
      const error = this.add
        .text(padX, bottom + space(this.layout, 10, 8), this.connectionError, {
          fontSize: `${px(this.layout, 16, 12)}px`,
          color: '#ff8a80',
          wordWrap: { width: width - padX * 2 },
        })
        .setOrigin(0, 0);
      this.root.add(error);
      bottom = error.y + error.height;
    }

    return bottom;
  }

  private buildList(top: number): void {
    const { width, height, padX, padBottom } = this.layout;

    this.listWidth = Math.min(width - padX * 2, dp(this.layout, MAX_LIST_WIDTH));
    this.listLeft = Math.round((width - this.listWidth) / 2);
    this.listTop = top;
    this.listHeight = Math.max(0, height - padBottom - top);

    this.list = this.add.container(this.listLeft, this.listTop);

    if (this.tables.length === 0) {
      const empty = this.add
        .text(this.listWidth / 2, space(this.layout, 24, 16), 'Nenhuma mesa disponível', {
          fontSize: `${px(this.layout, 18, 14)}px`,
          color: '#a8ccbf',
          align: 'center',
          wordWrap: { width: this.listWidth },
        })
        .setOrigin(0.5, 0);
      this.list.add(empty);
      this.maxScroll = 0;
      this.scrollTop = 0;
      return;
    }

    const rowHeight = space(this.layout, 84, 72);
    const gap = space(this.layout, 12, 8);

    this.tables.forEach((table, index) => {
      this.list.add(this.buildRow(table, index * (rowHeight + gap), rowHeight));
    });

    const contentHeight = this.tables.length * (rowHeight + gap) - gap;
    this.maxScroll = Math.max(0, contentHeight - this.listHeight);
    this.applyScroll(this.scrollTop);

    // O recorte impede que as filas invadam o cabeçalho enquanto a lista rola.
    const shape = this.make.graphics({}, false);
    shape.fillRect(this.listLeft, this.listTop, this.listWidth, this.listHeight);
    this.list.setMask(shape.createGeometryMask());
    this.listMask = shape;

    this.drawScrollbar();
  }

  private buildRow(
    table: LobbyTableSummary,
    y: number,
    rowHeight: number,
  ): Phaser.GameObjects.Container {
    const { portrait } = this.layout;
    const isFull = table.seatedCount >= table.maxSeats;
    const innerPad = space(this.layout, 16, 12);

    const background = this.add.graphics();
    background.fillStyle(0x134f3c, 1);
    background.fillRoundedRect(0, 0, this.listWidth, rowHeight, dp(this.layout, 12));
    background.lineStyle(dp(this.layout, 2), isFull ? 0x1a5a46 : 0x1e6b52, 1);
    background.strokeRoundedRect(0, 0, this.listWidth, rowHeight, dp(this.layout, 12));

    const join = createButton(this, {
      label: isFull ? 'Lotada' : 'Entrar',
      x: this.listWidth - innerPad,
      y: rowHeight / 2,
      layout: this.layout,
      fontSize: 17,
      anchorX: 1,
      anchorY: 0.5,
      variant: isFull ? 'disabled' : 'primary',
      onClick: () => this.joinTable(table.id),
    });

    const textWidth = this.listWidth - innerPad * 2 - join.width - space(this.layout, 12, 8);

    const name = this.add
      .text(innerPad, rowHeight / 2 - space(this.layout, 4, 3), table.name, {
        fontSize: `${px(this.layout, 22, 16)}px`,
        color: '#ffffff',
      })
      .setOrigin(0, 1);
    fitText(name, textWidth);

    // Deitado cabe a linha inteira; em pé, só o essencial.
    const details = portrait
      ? `${table.smallBlind}/${table.bigBlind} · ${table.seatedCount}/${table.maxSeats} jogadores`
      : `Blinds ${table.smallBlind}/${table.bigBlind} — ${table.seatedCount}/${table.maxSeats} jogadores`;

    const info = this.add
      .text(innerPad, rowHeight / 2 + space(this.layout, 4, 3), details, {
        fontSize: `${px(this.layout, 15, 12)}px`,
        color: '#a8ccbf',
      })
      .setOrigin(0, 0);
    fitText(info, textWidth);

    const row = this.add.container(0, y, [background, name, info, join]);
    row.setSize(this.listWidth, rowHeight);

    if (!isFull) {
      // A fila inteira é alvo de toque — no celular, mirar só no botão exige uma
      // precisão desnecessária.
      row.setInteractive({
        // Deslocado do `displayOrigin` do container — ver `ui/button.ts`.
        hitArea: new Phaser.Geom.Rectangle(
          this.listWidth / 2,
          rowHeight / 2,
          this.listWidth,
          rowHeight,
        ),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: true,
      });
      row.on('pointerup', () => this.joinTable(table.id));
    }

    return row;
  }

  private joinTable(tableId: string): void {
    // Soltou o dedo depois de arrastar: era rolagem, não escolha de mesa. Só vale
    // quando a lista realmente rola — com todas as mesas visíveis não há rolagem
    // possível, e aí o tremido normal do dedo cancelaria o toque à toa.
    if (this.maxScroll > 0 && this.dragDistance > dp(this.layout, DRAG_THRESHOLD)) {
      return;
    }
    this.scene.start('TableScene', { tableId });
  }

  private bindScrolling(): void {
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      this.dragging = true;
      this.dragStartY = pointer.y;
      this.dragStartScroll = this.scrollTop;
      this.dragDistance = 0;
    });

    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      if (!this.dragging || !pointer.isDown) {
        return;
      }
      const delta = pointer.y - this.dragStartY;
      this.dragDistance = Math.max(this.dragDistance, Math.abs(delta));
      this.applyScroll(this.dragStartScroll - delta);
    });

    const endDrag = (): void => {
      this.dragging = false;
    };
    this.input.on(Phaser.Input.Events.POINTER_UP, endDrag);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, endDrag);

    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (_pointer: Phaser.Input.Pointer, _over: unknown, _deltaX: number, deltaY: number) => {
        this.dragDistance = 0;
        this.applyScroll(this.scrollTop + deltaY * 0.5);
      },
    );
  }

  private applyScroll(value: number): void {
    this.scrollTop = Phaser.Math.Clamp(value, 0, this.maxScroll);
    this.list.y = this.listTop - this.scrollTop;
    this.drawScrollbar();
  }

  /** Barra fina de rolagem: mostra que há mais mesas do que cabe na tela. */
  private drawScrollbar(): void {
    this.scrollbar?.destroy();
    this.scrollbar = undefined;

    if (this.maxScroll <= 0) {
      return;
    }

    const trackHeight = this.listHeight;
    const thumbHeight = Math.max(
      dp(this.layout, 32),
      Math.round((trackHeight * trackHeight) / (trackHeight + this.maxScroll)),
    );
    const travel = trackHeight - thumbHeight;
    const thumbY = this.listTop + (this.scrollTop / this.maxScroll) * travel;
    // Na margem, se ela couber; senão encostada na borda de dentro das filas.
    const gutter = this.layout.padX >= dp(this.layout, 12);
    const x = this.listLeft + this.listWidth + dp(this.layout, gutter ? 4 : -6);

    const bar = this.add.graphics();
    bar.fillStyle(0xffffff, 0.12);
    bar.fillRoundedRect(x, this.listTop, dp(this.layout, 4), trackHeight, dp(this.layout, 2));
    bar.fillStyle(0xf5d47a, 0.7);
    bar.fillRoundedRect(x, thumbY, dp(this.layout, 4), thumbHeight, dp(this.layout, 2));
    this.scrollbar = bar;
  }
}
