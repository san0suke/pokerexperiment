import Phaser from 'phaser';
import type { ActionTakenPayload, Card, HandResultPayload, TableSeat, TableState } from '@poker/shared';
import { getSocket, type PokerClientSocket } from '../services/socket-client.js';
import { getUser } from '../services/auth-storage.js';
import { forgetTable, rememberTable } from '../services/table-session.js';
import { createButton, type ButtonVariant } from '../ui/button.js';
import { CARD_ASPECT, createCardFace } from '../ui/card.js';
import { createModalMessage } from '../ui/dialog.js';
import { readLayout, dp, px, space, type Layout } from '../ui/layout.js';
import { fitText } from '../ui/text.js';

interface TableSceneData {
  tableId: string;
}

interface ButtonSpec {
  label: string;
  variant: ButtonVariant;
  onClick: () => void;
}

/** Abaixo desta largura (em pixels de CSS) o rótulo do botão de saída encurta. */
const WIDE_LABEL_MIN_WIDTH = 600;
/** Quanto o oval pode ser mais comprido que largo (ou vice-versa). */
const MAX_OVAL_RATIO = 1.7;
/** Acima desta largura (em pixels de CSS) cabem todos os botões numa linha só. */
const WIDE_CONTROLS_MIN_WIDTH = 560;
/** Largura das cartas de um assento, em fração do raio do círculo. */
const SEAT_CARD_WIDTH_RATIO = 0.66;
/** Quanto a base das cartas entra no círculo do assento, em fração do raio. */
const SEAT_CARD_OVERLAP_RATIO = 0.3;
/**
 * Depois de tanto tempo fora do ar, o aviso de reconexão ganha uma saída para o
 * lobby. Sem ela, uma queda que não se resolve — token vencido, servidor fora —
 * deixa o jogador preso olhando para o aviso, porque ele cobre a tela inteira.
 */
const STUCK_OFFLINE_MS = 15_000;

/**
 * Mesa de poker: assentos em volta do feltro, cartas comunitárias, pote e os
 * controles de aposta de quem tem a vez.
 *
 * As duas cartas do rodapé são as únicas cartas reais que o cliente conhece
 * durante a mão — chegam por `hand:private-state`, só para este socket. Os
 * adversários aparecem com o verso até o showdown, quando o servidor manda as
 * cartas de quem foi até o fim em `hand:ended`.
 *
 * Toda ação daqui é uma sugestão: o servidor revalida fold/check/call/raise e
 * pode recusar. Os botões são montados a partir do estado público da mão, com as
 * mesmas contas do servidor, só para não oferecer o que seria recusado.
 *
 * A mesa não tem tamanho fixo: o oval e os assentos são calculados a partir do
 * espaço que sobra entre o cabeçalho e o rodapé, então em pé ele fica alto e
 * estreito e deitado fica largo e baixo. Tudo é redesenhado quando o aparelho
 * gira.
 */
export class TableScene extends Phaser.Scene {
  private tableId!: string;
  private layout!: Layout;
  private state: TableState | null = null;
  /** Minhas hole cards. Vazio fora da mão. */
  private holeCards: Card[] = [];
  /** Resultado da última mão, mostrado até a próxima começar. */
  private result: HandResultPayload | null = null;
  /** Última ação anunciada na mesa, para acompanhar o jogo. */
  private lastAction = '';
  private errorMessage = '';
  /** O jogador abriu as opções de aumento. */
  private raising = false;
  /** O socket caiu: a mesa na tela está congelada até ele voltar. */
  private offline = false;
  /** A queda já dura o bastante para oferecer a volta ao lobby. */
  private offlineForTooLong = false;
  private offlineTimer?: Phaser.Time.TimerEvent;
  private root!: Phaser.GameObjects.Container;

  constructor() {
    super('TableScene');
  }

  init(data: TableSceneData): void {
    this.tableId = data.tableId;
    this.state = null;
    this.holeCards = [];
    this.result = null;
    this.lastAction = '';
    this.errorMessage = '';
    this.raising = false;
    this.offline = false;
    this.offlineForTooLong = false;
  }

  create(): void {
    // Uma recarga da página volta para cá em vez de cair no lobby.
    rememberTable(this.tableId);
    this.build();

    const socket = getSocket();

    socket.on('table:state', (state) => {
      const startedNewHand = state.status === 'playing' && this.state?.status !== 'playing';
      this.state = state;
      this.errorMessage = '';

      if (startedNewHand) {
        this.result = null;
        this.lastAction = '';
      }
      // Fora da mão ninguém tem cartas; as do showdown ficam até a próxima mão.
      if (state.status === 'waiting' && !this.result) {
        this.holeCards = [];
      }
      if (state.hand?.turnSeat !== this.mySeat()?.seatIndex) {
        this.raising = false;
      }
      this.build();
    });

    socket.on('hand:private-state', (privateState) => {
      if (privateState.tableId !== this.tableId) {
        return;
      }
      this.holeCards = privateState.holeCards;
      this.result = null;
      this.build();
    });

    socket.on('hand:action-taken', (payload) => {
      this.lastAction = describeAction(payload);
      this.build();
    });

    socket.on('hand:ended', (payload) => {
      if (payload.tableId !== this.tableId) {
        return;
      }
      this.result = payload;
      this.lastAction = '';
      this.raising = false;
      this.build();
    });

    socket.on('server:error', (error) => {
      this.errorMessage = error.message;
      this.build();
    });

    /*
     * Queda e volta. O socket.io reconecta sozinho, mas o socket que volta é
     * outro: ele não está mais na sala da mesa e o servidor não tem como saber
     * que aquele jogador é o mesmo até ele pedir o assento de novo. Enquanto
     * isso o jogador vê a mesa congelada, então o aviso é obrigatório.
     */
    socket.on('disconnect', () => this.markOffline());
    // Servidor fora do ar ou token vencido: a conexão nem chega a existir, então
    // o `disconnect` nunca vem — e sem isto a mesa ficaria vazia e muda.
    socket.on('connect_error', () => this.markOffline());

    socket.on('connect', () => {
      this.offline = false;
      this.offlineForTooLong = false;
      this.offlineTimer?.remove();
      this.offlineTimer = undefined;
      this.requestSeat(socket);
      this.build();
    });

    this.requestSeat(socket);

    document.addEventListener('visibilitychange', this.handleVisibility);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      socket.off('table:state');
      socket.off('hand:private-state');
      socket.off('hand:action-taken');
      socket.off('hand:ended');
      socket.off('server:error');
      socket.off('disconnect');
      socket.off('connect');
      socket.off('connect_error');
      this.offlineTimer?.remove();
      document.removeEventListener('visibilitychange', this.handleVisibility);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    });
  }

  /** A mesa na tela congelou: o aviso sobe e o relógio da saída começa a contar. */
  private markOffline(): void {
    if (this.offline) {
      return;
    }
    this.offline = true;
    this.offlineTimer?.remove();
    this.offlineTimer = this.time.delayedCall(STUCK_OFFLINE_MS, () => {
      this.offlineForTooLong = true;
      this.build();
    });
    this.build();
  }

  /**
   * Pede o assento — na entrada e a cada reconexão. O servidor devolve o mesmo
   * assento enquanto o prazo de reconexão dele não estourou, junto com as cartas
   * da mão em andamento, que vão só para este socket.
   */
  private requestSeat(socket: PokerClientSocket): void {
    socket.emit('table:join', { tableId: this.tableId }, (state) => {
      if (state) {
        this.state = state;
        this.build();
      }
    });
  }

  /**
   * Voltar para o app é o momento em que a queda aparece: em segundo plano o
   * celular congela os temporizadores, então a tentativa de reconexão do
   * socket.io pode estar parada há minutos. Aqui ela recomeça na hora.
   */
  private handleVisibility = (): void => {
    if (document.visibilityState !== 'visible') {
      return;
    }
    const socket = getSocket();
    if (!socket.connected) {
      socket.connect();
    }
  };

  private handleResize(): void {
    this.build();
  }

  /** Sair pela porta da frente: o assento é liberado na hora, sem prazo nenhum. */
  private backToLobby(): void {
    getSocket().emit('table:leave', { tableId: this.tableId });
    forgetTable();
    this.scene.start('LobbyScene');
  }

  /** Assento do jogador logado, ou null se ele não está sentado nesta mesa. */
  private mySeat(): TableSeat | null {
    const userId = getUser()?.id;
    return this.state?.seats.find((seat) => seat.user?.id === userId) ?? null;
  }

  private occupiedSeats(): TableSeat[] {
    return this.state?.seats.filter((seat) => seat.user !== null) ?? [];
  }

  private seatOf(seatIndex: number): TableSeat | undefined {
    return this.state?.seats.find((seat) => seat.seatIndex === seatIndex);
  }

  /**
   * As mesmas contas que o servidor faz para validar a ação. Serve só para montar
   * os botões — quem decide continua sendo o servidor.
   */
  private myOptions() {
    const hand = this.state?.hand;
    const seat = this.mySeat();
    if (!hand || !seat || !seat.inHand || seat.folded || hand.turnSeat !== seat.seatIndex) {
      return null;
    }

    const toCall = Math.max(0, hand.currentBet - seat.bet);
    const maxRaiseTo = seat.bet + seat.chips;

    return {
      toCall,
      callAmount: Math.min(toCall, seat.chips),
      canCheck: toCall === 0,
      canCall: toCall > 0 && seat.chips > 0,
      canRaise: seat.chips > toCall && maxRaiseTo > hand.currentBet,
      minRaiseTo: Math.min(hand.minRaiseTo, maxRaiseTo),
      maxRaiseTo,
      pot: hand.pot,
      seat,
    };
  }

  private act(action: 'fold' | 'check' | 'call' | 'raise', amount?: number): void {
    this.raising = false;
    getSocket().emit('hand:action', { tableId: this.tableId, action, amount });
  }

  /** Redesenha a mesa inteira com as medidas atuais da tela. */
  private build(): void {
    this.layout = readLayout(this.scale);
    this.root?.destroy(true);
    this.root = this.add.container(0, 0);

    const headerBottom = this.buildHeader();
    const footerTop = this.buildFooter();
    this.buildTable(headerBottom + space(this.layout, 12, 8), footerTop - space(this.layout, 12, 8));

    // Por último: o aviso cobre a mesa inteira e engole os toques dos botões.
    if (this.offline) {
      this.root.add(
        createModalMessage(this, this.layout, {
          title: 'Reconectando...',
          detail: this.offlineForTooLong
            ? 'A conexão não voltou. Seu assento fica guardado por pouco tempo — depois disso a mesa o libera.'
            : 'Seu assento e suas fichas estão guardados. É só um instante.',
          action: this.offlineForTooLong
            ? { label: 'Voltar ao lobby', onClick: () => this.backToLobby() }
            : undefined,
        }),
      );
    }
  }

  /** Desenha o cabeçalho e devolve a altura ocupada por ele. */
  private buildHeader(): number {
    const { width, padX, padTop } = this.layout;

    const leave = createButton(this, {
      label: width >= dp(this.layout, WIDE_LABEL_MIN_WIDTH) ? 'Voltar ao lobby' : '← Lobby',
      x: width - padX,
      y: padTop,
      layout: this.layout,
      fontSize: 16,
      anchorX: 1,
      onClick: () => this.backToLobby(),
    });

    const label = this.state?.name ?? 'Carregando mesa...';
    const title = this.add
      .text(padX, padTop + leave.height / 2, label, {
        fontSize: `${px(this.layout, 28, 18)}px`,
        fontStyle: 'bold',
        color: '#f5d47a',
      })
      .setOrigin(0, 0.5);
    fitText(title, width - padX * 2 - leave.width - space(this.layout, 12, 8));

    this.root.add([title, leave]);

    let bottom = padTop + leave.height;

    const message = this.errorMessage || this.lastAction;
    if (message) {
      const line = this.add
        .text(padX, bottom + space(this.layout, 8, 6), message, {
          fontSize: `${px(this.layout, 15, 12)}px`,
          color: this.errorMessage ? '#ff8a80' : '#cfe8dd',
          wordWrap: { width: width - padX * 2 },
        })
        .setOrigin(0, 0);
      this.root.add(line);
      bottom = line.y + line.height;
    }

    return bottom;
  }

  /**
   * Rodapé: controles de aposta e as próprias cartas durante a mão, o
   * pronto/não pronto entre as mãos. Devolve o topo da faixa ocupada.
   */
  private buildFooter(): number {
    const { height, padBottom } = this.layout;
    const bottom = height - padBottom;

    const state = this.state;
    const seat = this.mySeat();
    if (!state || !seat) {
      return bottom;
    }

    if (state.status === 'playing') {
      if (!seat.inHand) {
        return this.buildFooterNote(bottom, 'Você entra na próxima mão');
      }

      let top = bottom;
      const options = this.myOptions();
      if (options) {
        top = this.raising ? this.buildRaiseControls(top) : this.buildActionControls(top);
      } else if (seat.folded) {
        top = this.buildFooterNote(top, 'Você desistiu desta mão');
      } else {
        top = this.buildFooterNote(top, this.waitingForLabel());
      }

      return this.buildHoleCards(top - space(this.layout, 8, 6));
    }

    return this.buildReadyControls(bottom, seat);
  }

  private waitingForLabel(): string {
    const turnSeat = this.state?.hand?.turnSeat;
    if (turnSeat === null || turnSeat === undefined) {
      return 'Abrindo as cartas da mesa...';
    }
    const name = this.seatOf(turnSeat)?.user?.username ?? '?';
    return `Vez de ${name}`;
  }

  /** Fold / passar ou pagar / aumentar. */
  private buildActionControls(bottom: number): number {
    const options = this.myOptions()!;
    const specs: ButtonSpec[] = [
      { label: 'Desistir', variant: 'ghost', onClick: () => this.act('fold') },
    ];

    if (options.canCheck) {
      specs.push({ label: 'Passar', variant: 'primary', onClick: () => this.act('check') });
    } else if (options.canCall) {
      const allIn = options.callAmount >= options.seat.chips;
      specs.push({
        label: allIn ? `All-in ${options.callAmount}` : `Pagar ${options.callAmount}`,
        variant: 'primary',
        onClick: () => this.act('call'),
      });
    }

    if (options.canRaise) {
      specs.push({
        label: options.toCall > 0 ? 'Aumentar' : 'Apostar',
        variant: 'ghost',
        onClick: () => {
          this.raising = true;
          this.build();
        },
      });
    }

    return this.buildButtonRows(specs, bottom);
  }

  /**
   * Valores prontos de aumento em vez de um campo numérico: no celular, digitar
   * ou arrastar um slider no meio da mão é o caminho mais lento até o erro.
   */
  private buildRaiseControls(bottom: number): number {
    const options = this.myOptions()!;
    const { minRaiseTo, maxRaiseTo, callAmount, pot, seat } = options;

    const clamp = (value: number) =>
      Phaser.Math.Clamp(Math.round(value), minRaiseTo, maxRaiseTo);
    // Aposta do tamanho do pote: o pote já com o call pago, somado ao que falta cobrir.
    const potAfterCall = pot + callAmount;
    const candidates: [string, number][] = [
      ['Mín', minRaiseTo],
      ['½ pote', clamp(seat.bet + callAmount + potAfterCall / 2)],
      ['Pote', clamp(seat.bet + callAmount + potAfterCall)],
      ['All-in', maxRaiseTo],
    ];

    const seen = new Set<number>();
    const specs: ButtonSpec[] = [];
    for (const [label, value] of candidates) {
      if (seen.has(value)) {
        continue;
      }
      seen.add(value);
      specs.push({
        label: `${label} ${value}`,
        variant: value === maxRaiseTo ? 'ghost' : 'primary',
        onClick: () => this.act('raise', value),
      });
    }

    specs.push({
      label: 'Voltar',
      variant: 'ghost',
      onClick: () => {
        this.raising = false;
        this.build();
      },
    });

    return this.buildButtonRows(specs, bottom);
  }

  private buildReadyControls(bottom: number, seat: TableSeat): number {
    const { width, padX, ui } = this.layout;

    const broke = seat.chips === 0;
    const button = createButton(this, {
      label: seat.ready ? 'Não estou pronto' : broke ? 'Recomprar e jogar' : 'Estou pronto',
      x: width / 2,
      y: bottom,
      layout: this.layout,
      fontSize: 18,
      anchorX: 0.5,
      anchorY: 1,
      minWidth: Math.min(width - padX * 2, Math.round(220 * ui)),
      variant: seat.ready ? 'ghost' : 'primary',
      onClick: () => {
        getSocket().emit('table:set-ready', { tableId: this.tableId, ready: !seat.ready });
      },
    });

    const seated = this.occupiedSeats().filter((other) => other.chips > 0 || other.ready);
    const readyCount = seated.filter((other) => other.ready).length;
    const hint =
      seated.length < 2
        ? 'Esperando mais um jogador para começar'
        : `${readyCount} de ${seated.length} prontos — a mão começa quando todos estiverem`;

    const status = this.add
      .text(width / 2, bottom - button.height - space(this.layout, 8, 6), hint, {
        fontSize: `${px(this.layout, 15, 12)}px`,
        color: '#a8ccbf',
        align: 'center',
        wordWrap: { width: width - padX * 2 },
      })
      .setOrigin(0.5, 1);

    this.root.add([button, status]);

    let top = status.y - status.height;
    if (this.holeCards.length > 0 && this.result) {
      top = this.buildHoleCards(top - space(this.layout, 8, 6));
    }
    return top;
  }

  /**
   * Distribui os botões em linhas centradas. Em telas estreitas quebra em duas
   * linhas em vez de espremer os alvos de toque abaixo do mínimo.
   */
  private buildButtonRows(specs: ButtonSpec[], bottom: number): number {
    const { width, padX, ui } = this.layout;
    const gap = space(this.layout, 8, 6);
    const perRow =
      width >= dp(this.layout, WIDE_CONTROLS_MIN_WIDTH) ? specs.length : Math.min(specs.length, 2);

    const rows: ButtonSpec[][] = [];
    for (let i = 0; i < specs.length; i += perRow) {
      rows.push(specs.slice(i, i + perRow));
    }

    let rowBottom = bottom;
    // De baixo para cima: a última linha encosta na borda inferior.
    for (const row of [...rows].reverse()) {
      const available = width - padX * 2 - gap * (row.length - 1);
      const target = Math.min(Math.round(180 * ui), Math.floor(available / row.length));

      const buttons = row.map((spec) =>
        createButton(this, {
          label: spec.label,
          x: 0,
          y: rowBottom,
          layout: this.layout,
          fontSize: 17,
          anchorX: 0.5,
          anchorY: 1,
          minWidth: target,
          variant: spec.variant,
          onClick: spec.onClick,
        }),
      );

      const totalWidth = buttons.reduce((sum, button) => sum + button.width, 0) + gap * (row.length - 1);
      let x = (width - totalWidth) / 2;
      for (const button of buttons) {
        button.x = x + button.width / 2;
        x += button.width + gap;
      }

      this.root.add(buttons);
      rowBottom -= buttons[0].height + gap;
    }

    return rowBottom + gap;
  }

  /** As duas cartas do jogador, centradas acima da borda de baixo. */
  private buildHoleCards(bottom: number): number {
    const { width, padX, ui } = this.layout;

    const cardWidth = Phaser.Math.Clamp(
      Math.round(width * 0.14),
      dp(this.layout, 40),
      Math.round(76 * ui),
    );
    const cardHeight = Math.round(cardWidth * CARD_ASPECT);
    const gap = space(this.layout, 10, 6);
    const centerY = bottom - cardHeight / 2;

    // Cartas ainda não chegaram (reconexão no meio da mão): desenha o verso.
    const cards: (Card | null)[] = this.holeCards.length === 2 ? this.holeCards : [null, null];

    cards.forEach((card, index) => {
      const offset = (index - (cards.length - 1) / 2) * (cardWidth + gap);
      this.root.add(
        createCardFace(this, { card, x: width / 2 + offset, y: centerY, width: cardWidth }),
      );
    });

    const label = this.add
      .text(width / 2, centerY - cardHeight / 2 - space(this.layout, 6, 4), 'Suas cartas', {
        fontSize: `${px(this.layout, 13, 10)}px`,
        color: '#a8ccbf',
      })
      .setOrigin(0.5, 1);
    fitText(label, width - padX * 2);

    this.root.add(label);
    return label.y - label.height;
  }

  private buildFooterNote(bottom: number, text: string): number {
    const { width, padX } = this.layout;

    const note = this.add
      .text(width / 2, bottom, text, {
        fontSize: `${px(this.layout, 15, 12)}px`,
        color: '#a8ccbf',
        align: 'center',
        wordWrap: { width: width - padX * 2 },
      })
      .setOrigin(0.5, 1);

    this.root.add(note);
    return note.y - note.height;
  }

  private buildTable(top: number, bottom: number): void {
    const { width, padX } = this.layout;

    const areaWidth = width - padX * 2;
    const areaHeight = Math.max(dp(this.layout, 120), bottom - top);
    const centerX = width / 2;
    const centerY = top + areaHeight / 2;

    // Os assentos ficam sobre a borda do oval, então precisam do próprio raio de
    // folga para não vazarem da tela. No eixo Y sobra ainda o rótulo de fichas
    // desenhado abaixo do círculo.
    const seatRadius = Phaser.Math.Clamp(
      Math.min(areaWidth, areaHeight) * 0.12,
      dp(this.layout, 20),
      dp(this.layout, 44),
    );
    const labelRoom = space(this.layout, 18, 14);
    // Acima do assento ficam as cartas e abaixo o rótulo de fichas; a folga é a
    // maior das duas, senão o showdown corta as cartas dos assentos de cima.
    const marginY = Math.max(seatRadius + labelRoom, this.seatCardBox(seatRadius).room);
    let ringRadiusX = Math.max(seatRadius, areaWidth / 2 - seatRadius);
    let ringRadiusY = Math.max(seatRadius, areaHeight / 2 - marginY);

    // Ocupar toda a área em pé transformaria a mesa num tubo, com os jogadores
    // laterais espremidos contra as bordas da tela. O limite de proporção mantém
    // o formato de mesa nas duas orientações; o que sobra vira respiro.
    ringRadiusX = Math.min(ringRadiusX, ringRadiusY * MAX_OVAL_RATIO);
    ringRadiusY = Math.min(ringRadiusY, ringRadiusX * MAX_OVAL_RATIO);

    const felt = this.add
      .ellipse(centerX, centerY, ringRadiusX * 1.76, ringRadiusY * 1.64, 0x14654c)
      .setStrokeStyle(space(this.layout, 8, 4), 0x5b3a1e);
    this.root.add(felt);

    this.buildCenter(centerX, centerY, ringRadiusX, ringRadiusY);

    const seats = this.state?.seats ?? [];
    seats.forEach((seat, index) => {
      // Start at the bottom of the oval so seat 0 faces the player.
      const angle = Math.PI / 2 + (index / seats.length) * Math.PI * 2;
      const x = centerX + Math.cos(angle) * ringRadiusX;
      const y = centerY + Math.sin(angle) * ringRadiusY;
      this.buildSeat(seat, x, y, seatRadius, centerX);
    });
  }

  /** Miolo do feltro: cartas comunitárias, pote e o resultado da última mão. */
  private buildCenter(
    centerX: number,
    centerY: number,
    ringRadiusX: number,
    ringRadiusY: number,
  ): void {
    const hand = this.state?.hand;
    const maxWidth = ringRadiusX * 1.5;
    // O feltro não esvazia quando a mão acaba: sem mão em andamento o board vem
    // do resultado e fica na mesa até a próxima começar.
    const board = hand?.communityCards ?? this.result?.communityCards ?? [];

    const label = hand
      ? this.add.text(0, 0, `Pote: ${hand.pot}`, {
          fontSize: `${px(this.layout, 20, 14)}px`,
          fontStyle: 'bold',
          color: '#f5d47a',
        })
      : this.add.text(
          0,
          0,
          (this.result ? describeResult(this.result) : ['Aguardando os jogadores']).join('\n'),
          {
            fontSize: `${px(this.layout, 16, 12)}px`,
            color: this.result ? '#f5d47a' : '#7fb8a2',
            align: 'center',
            lineSpacing: space(this.layout, 4, 3),
            wordWrap: { width: maxWidth },
          },
        );
    if (hand) {
      fitText(label, maxWidth);
    }

    if (board.length === 0) {
      label.setPosition(centerX, centerY).setOrigin(0.5);
      this.root.add(label);
      return;
    }

    const gap = space(this.layout, 6, 4);
    const cardWidth = Math.max(
      dp(this.layout, 24),
      Math.min(
        Math.round(56 * this.layout.ui),
        Math.floor((maxWidth - gap * (board.length - 1)) / board.length),
        Math.floor((ringRadiusY * 1.1) / CARD_ASPECT),
      ),
    );
    const cardHeight = Math.round(cardWidth * CARD_ASPECT);
    const spacing = space(this.layout, 12, 8);

    // Cartas e texto centrados como um bloco só: o resultado ocupa duas ou três
    // linhas, e ancorar tudo no centro da mesa jogaria o texto sobre os assentos.
    const top = centerY - (cardHeight + spacing + label.height) / 2;

    board.forEach((card, index) => {
      const offset = (index - (board.length - 1) / 2) * (cardWidth + gap);
      this.root.add(
        createCardFace(this, {
          card,
          x: centerX + offset,
          y: top + cardHeight / 2,
          width: cardWidth,
        }),
      );
    });

    label.setPosition(centerX, top + cardHeight + spacing).setOrigin(0.5, 0);
    this.root.add(label);
  }

  /**
   * Onde ficam as cartas de um assento: acima do círculo, encostando na borda de
   * cima. `room` é a altura que elas ocupam a partir do centro do assento — a
   * mesa usa isso para não empurrar os assentos de cima para fora da área.
   */
  private seatCardBox(seatRadius: number): { width: number; height: number; room: number } {
    const width = Math.max(dp(this.layout, 14), Math.round(seatRadius * SEAT_CARD_WIDTH_RATIO));
    const height = Math.round(width * CARD_ASPECT);
    return { width, height, room: seatRadius * (1 - SEAT_CARD_OVERLAP_RATIO) + height };
  }

  private buildSeat(
    seat: TableSeat,
    x: number,
    y: number,
    seatRadius: number,
    centerX: number,
  ): void {
    const occupied = seat.user !== null;
    const shown = this.result?.showdown.find((entry) => entry.seatIndex === seat.seatIndex);
    const isMine = seat.seatIndex === this.mySeat()?.seatIndex;

    const circle = this.add
      .circle(x, y, seatRadius, occupied ? (seat.folded ? 0x123f33 : 0x1f7a5c) : 0x0e3f31)
      .setStrokeStyle(dp(this.layout, this.isTurn(seat) ? 5 : 3), this.seatStrokeColor(seat));
    if (seat.folded) {
      circle.setAlpha(0.55);
    }

    // Num assento pequeno "Assento 3" vira três linhas ilegíveis; só o número.
    const emptyLabel = seatRadius >= 34 ? `Assento ${seat.seatIndex + 1}` : `${seat.seatIndex + 1}`;

    const label = this.add
      .text(x, y, occupied ? seat.user!.username : emptyLabel, {
        fontSize: `${px(this.layout, 14, 11)}px`,
        fontStyle: isMine ? 'bold' : 'normal',
        color: occupied ? '#ffffff' : '#7d9c90',
      })
      .setOrigin(0.5);
    // O nome não quebra linha dentro de um círculo pequeno — encurta.
    fitText(label, seatRadius * 1.7);

    this.root.add([circle, label]);

    if (!occupied) {
      return;
    }

    // Cartas do assento: de costas enquanto a mão corre e abertas no showdown,
    // para todo mundo que chegou vivo ao fim da mão. Vão depois do círculo e
    // acima dele — desenhadas antes, ficavam escondidas atrás do nome.
    const revealed: (Card | null)[] | null = shown
      ? shown.holeCards
      : seat.inHand && !seat.folded
        ? [null, null]
        : null;

    if (revealed && revealed.length > 0) {
      const { width: cardWidth, height: cardHeight, room } = this.seatCardBox(seatRadius);
      const spread = Math.round(cardWidth * 0.55);
      const cardY = y - room + cardHeight / 2;
      revealed.forEach((card, index) => {
        this.root.add(
          createCardFace(this, {
            card,
            x: x + (index - (revealed.length - 1) / 2) * spread * 2,
            y: cardY,
            width: cardWidth,
          }),
        );
      });
    }

    const detail = this.add
      .text(x, y + seatRadius + space(this.layout, 4, 3), this.seatDetail(seat, shown?.description), {
        fontSize: `${px(this.layout, 13, 10)}px`,
        color: this.seatDetailColor(seat),
      })
      .setOrigin(0.5, 0);
    fitText(detail, seatRadius * 3);
    this.root.add(detail);

    // A aposta da rua fica ao lado do assento, virada para o centro da mesa,
    // como as fichas empurradas para a frente numa mesa de verdade. Ao lado, e
    // não acima, porque acima estão as cartas.
    if (seat.bet > 0) {
      const toCenter = x <= centerX ? 1 : -1;
      const bet = this.add
        .text(x + toCenter * (seatRadius + space(this.layout, 4, 3)), y, `${seat.bet}`, {
          fontSize: `${px(this.layout, 13, 10)}px`,
          fontStyle: 'bold',
          color: '#0b3d2e',
          backgroundColor: '#f5d47a',
          padding: { x: space(this.layout, 6, 4), y: space(this.layout, 2, 2) },
        })
        .setOrigin(toCenter === 1 ? 0 : 1, 0.5);
      this.root.add(bet);
    }
  }

  private isTurn(seat: TableSeat): boolean {
    return seat.user !== null && this.state?.hand?.turnSeat === seat.seatIndex;
  }

  private seatStrokeColor(seat: TableSeat): number {
    if (seat.user === null) {
      return 0x2c5b4c;
    }
    if (this.isTurn(seat)) {
      return 0x6ee7a8;
    }
    if (this.state?.status === 'waiting' && seat.ready) {
      return 0x6ee7a8;
    }
    return 0xf5d47a;
  }

  /** Linha abaixo do assento: fichas e o estado do jogador na mão. */
  private seatDetail(seat: TableSeat, showdown?: string): string {
    const parts = [`${seat.chips}`];

    // Quem caiu continua com o assento por alguns segundos: os outros precisam
    // saber por que a mesa está esperando.
    if (seat.disconnected) {
      parts.push('caiu');
    }

    const hand = this.state?.hand;
    if (showdown) {
      parts.push(showdown);
    } else if (hand) {
      if (seat.folded) {
        parts.push('desistiu');
      } else if (seat.allIn) {
        parts.push('all-in');
      }

      const positions: string[] = [];
      if (seat.seatIndex === hand.dealerSeat) {
        positions.push('D');
      }
      if (seat.seatIndex === hand.smallBlindSeat) {
        positions.push('SB');
      }
      if (seat.seatIndex === hand.bigBlindSeat) {
        positions.push('BB');
      }
      if (positions.length > 0) {
        parts.push(positions.join('/'));
      }
    } else if (this.result?.winners.some((winner) => winner.seatIndex === seat.seatIndex)) {
      parts.push('ganhou');
    } else {
      parts.push(seat.ready ? 'pronto' : 'aguardando');
    }

    return parts.join(' · ');
  }

  private seatDetailColor(seat: TableSeat): string {
    if (this.state?.status === 'waiting' && !this.result) {
      return seat.ready ? '#8ee6b0' : '#a8ccbf';
    }
    return seat.folded ? '#7d9c90' : '#cfe8dd';
  }
}

/** "bob aumentou para 40" — o que a mesa ouviria numa mesa de verdade. */
function describeAction(payload: ActionTakenPayload): string {
  const { username, action, amount, allIn } = payload;
  if (allIn && action !== 'fold') {
    return `${username} foi de all-in (${amount})`;
  }
  switch (action) {
    case 'fold':
      return `${username} desistiu`;
    case 'check':
      return `${username} passou`;
    case 'call':
      return `${username} pagou ${amount}`;
    case 'raise':
      return `${username} aumentou para ${amount}`;
  }
}

function describeResult(result: HandResultPayload): string[] {
  if (result.winners.length === 0) {
    return ['Mão encerrada'];
  }

  const lines = result.winners.map((winner) => {
    const hand = result.showdown.find((entry) => entry.seatIndex === winner.seatIndex);
    return hand
      ? `${winner.username} levou ${winner.amount} com ${hand.description.toLowerCase()}`
      : `${winner.username} levou ${winner.amount}`;
  });

  if (result.showdown.length === 0) {
    lines.push('Os outros desistiram');
  }
  return lines;
}
