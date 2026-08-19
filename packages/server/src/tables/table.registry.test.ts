import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '@poker/shared';
import {
  applyPlayerAction,
  applyTurnTimeout,
  getSeatedTableId,
  getTableState,
  getTurnDeadline,
  markUserConnected,
  markUserDisconnected,
  canStartHand,
  seatUser,
  setReady,
  startTableHand,
  unseatUser,
  TURN_TIMEOUT_MS,
} from './table.registry.js';

const TABLE_ID = 'table-1';
/** Saldo que o jogador traz da conta — nas mesas não há mais buy-in fixo. */
const STACK = 1000;
const user: AuthenticatedUser = { id: 'user-queda', username: 'quedinha' };

const seatOf = (userId: string) =>
  getTableState(TABLE_ID)?.seats.find((seat) => seat.user?.id === userId) ?? null;

// As mesas são um Map de módulo: o que um teste senta, ele tira.
afterEach(() => {
  unseatUser(TABLE_ID, user.id);
});

describe('queda e volta do jogador', () => {
  it('guarda o assento marcado como caído em vez de liberá-lo', () => {
    seatUser(TABLE_ID, user, STACK);

    expect(markUserDisconnected(user.id)).toEqual([TABLE_ID]);
    expect(seatOf(user.id)?.disconnected).toBe(true);
  });

  it('derruba o pronto de quem caiu, para a mão seguinte não começar sem ele', () => {
    seatUser(TABLE_ID, user, STACK);
    setReady(TABLE_ID, user.id, true);

    markUserDisconnected(user.id);

    expect(seatOf(user.id)?.ready).toBe(false);
  });

  it('reacende o assento quando o jogador volta', () => {
    seatUser(TABLE_ID, user, STACK);
    markUserDisconnected(user.id);

    expect(markUserConnected(user.id)).toEqual([TABLE_ID]);
    expect(seatOf(user.id)?.disconnected).toBe(false);
    // Segunda volta não tem o que reacender.
    expect(markUserConnected(user.id)).toEqual([]);
  });

  it('sentar de novo já vale como volta', () => {
    seatUser(TABLE_ID, user, STACK);
    markUserDisconnected(user.id);

    seatUser(TABLE_ID, user, STACK);

    expect(seatOf(user.id)?.disconnected).toBe(false);
  });

  it('não mexe em quem não está sentado', () => {
    expect(markUserDisconnected('ninguem')).toEqual([]);
    expect(markUserConnected('ninguem')).toEqual([]);
  });
});

describe('relógio da vez', () => {
  const players: AuthenticatedUser[] = [
    { id: 'user-relogio-1', username: 'ligeiro' },
    { id: 'user-relogio-2', username: 'pensador' },
  ];

  const hand = () => getTableState(TABLE_ID)?.hand ?? null;

  /** Quem está com a vez agora — a ordem depende de onde o botão parou. */
  const userOnTurn = () => {
    const state = getTableState(TABLE_ID)!;
    return state.seats.find((seat) => seat.seatIndex === state.hand?.turnSeat)?.user?.id ?? null;
  };

  // O relógio é um horário absoluto comparado com `Date.now()`; sem controlar o
  // tempo, testar o estouro do prazo levaria 25 segundos por caso.
  beforeEach(() => {
    vi.useFakeTimers();
    for (const player of players) {
      seatUser(TABLE_ID, player, STACK);
      setReady(TABLE_ID, player.id, true);
    }
    startTableHand(TABLE_ID);
  });

  afterEach(() => {
    for (const player of players) {
      unseatUser(TABLE_ID, player.id);
    }
    vi.useRealTimers();
  });

  it('dá o prazo cheio para quem abre a mão', () => {
    expect(hand()?.turnEndsInMs).toBe(TURN_TIMEOUT_MS);
    expect(hand()?.turnDurationMs).toBe(TURN_TIMEOUT_MS);
  });

  it('não joga por ninguém enquanto o prazo corre', () => {
    vi.advanceTimersByTime(TURN_TIMEOUT_MS - 1_000);

    expect(applyTurnTimeout(TABLE_ID).taken).toBeUndefined();
    expect(hand()?.turnEndsInMs).toBe(1_000);
  });

  it('desiste por quem não joga quando há aposta a pagar', () => {
    // Heads-up: quem abre é o small blind, com o big blind na frente para cobrir.
    vi.advanceTimersByTime(TURN_TIMEOUT_MS);
    const result = applyTurnTimeout(TABLE_ID);

    expect(result.taken?.action).toBe('fold');
    expect(result.taken?.timedOut).toBe(true);
    // A mão acabou com a desistência, e a aposta não coberta voltou para o big blind.
    expect(result.ended?.pot).toBe(10);
    expect(getTurnDeadline(TABLE_ID)).toBeNull();
  });

  it('passa por quem não joga quando não há nada a pagar', () => {
    applyPlayerAction(TABLE_ID, userOnTurn()!, 'call');

    // Agora é a vez do big blind, com a aposta coberta: passar não custa ficha.
    vi.advanceTimersByTime(TURN_TIMEOUT_MS);
    const result = applyTurnTimeout(TABLE_ID);

    expect(result.taken?.action).toBe('check');
    expect(result.taken?.timedOut).toBe(true);
    expect(hand()?.round).toBe('flop');
  });

  it('recomeça a contagem a cada ação', () => {
    vi.advanceTimersByTime(TURN_TIMEOUT_MS - 5_000);
    applyPlayerAction(TABLE_ID, userOnTurn()!, 'call');

    expect(hand()?.turnEndsInMs).toBe(TURN_TIMEOUT_MS);
  });

  it('para o relógio quando a mão acaba', () => {
    applyPlayerAction(TABLE_ID, userOnTurn()!, 'fold');

    expect(getTurnDeadline(TABLE_ID)).toBeNull();
    expect(hand()).toBeNull();
  });
});

describe('mesa com jogador ausente', () => {
  const players: AuthenticatedUser[] = [
    { id: 'user-ausente-1', username: 'presente' },
    { id: 'user-ausente-2', username: 'sumido' },
  ];
  const [staying, leaving] = players;

  const seatsTaken = () =>
    getTableState(TABLE_ID)?.seats.filter((seat) => seat.user !== null) ?? [];

  beforeEach(() => {
    vi.useFakeTimers();
    for (const player of players) {
      seatUser(TABLE_ID, player, STACK);
    }
  });

  afterEach(() => {
    for (const player of players) {
      unseatUser(TABLE_ID, player.id);
    }
    vi.useRealTimers();
  });

  it('guarda o assento de quem caiu por tempo indeterminado', () => {
    markUserDisconnected(leaving.id);
    // Muito além de qualquer prazo: a mesa não some porque a internet oscilou.
    vi.advanceTimersByTime(60 * 60_000);

    const seats = seatsTaken();
    expect(seats).toHaveLength(2);
    expect(seats.find((seat) => seat.user?.id === leaving.id)?.disconnected).toBe(true);
  });

  it('mantém os dois assentos quando a mesa inteira cai', () => {
    for (const player of players) {
      markUserDisconnected(player.id);
    }
    vi.advanceTimersByTime(60 * 60_000);

    expect(seatsTaken()).toHaveLength(2);

    // Quem volta primeiro encontra a mesa como deixou: o vizinho ainda ausente.
    markUserConnected(staying.id);
    const seats = seatsTaken();
    expect(seats.find((seat) => seat.user?.id === staying.id)?.disconnected).toBe(false);
    expect(seats.find((seat) => seat.user?.id === leaving.id)?.disconnected).toBe(true);
  });

  it('o relógio da vez continua correndo para quem está ausente', () => {
    for (const player of players) {
      setReady(TABLE_ID, player.id, true);
    }
    startTableHand(TABLE_ID);
    // A mesa inteira some no meio da mão: ela ainda assim vai até o fim.
    for (const player of players) {
      markUserDisconnected(player.id);
    }

    let guard = 0;
    while (getTableState(TABLE_ID)?.hand !== null && guard < 20) {
      vi.advanceTimersByTime(TURN_TIMEOUT_MS);
      expect(applyTurnTimeout(TABLE_ID).taken?.timedOut).toBe(true);
      guard += 1;
    }

    expect(getTableState(TABLE_ID)?.hand).toBeNull();
    // E ninguém perdeu o lugar por causa disso.
    expect(seatsTaken()).toHaveLength(2);
  });

  it('não conta o ausente para começar a mão', () => {
    markUserDisconnected(leaving.id);
    setReady(TABLE_ID, staying.id, true);

    // Sobrou um jogador de verdade: não há mão com um só.
    expect(canStartHand(TABLE_ID)).toBe(false);
  });

  it('não deixa o ausente travar a mesa dos outros', () => {
    const third: AuthenticatedUser = { id: 'user-ausente-3', username: 'terceiro' };
    seatUser(TABLE_ID, third, STACK);
    markUserDisconnected(leaving.id);

    setReady(TABLE_ID, staying.id, true);
    setReady(TABLE_ID, third.id, true);

    // Antes, `canStartHand` exigia o pronto de todo mundo — e o ausente nunca
    // fica pronto, então a mesa não começava mais nenhuma mão.
    expect(canStartHand(TABLE_ID)).toBe(true);

    const privates = startTableHand(TABLE_ID);
    expect(privates?.map((entry) => entry.userId).sort()).toEqual([staying.id, third.id].sort());

    // E o ausente não pagou blind nenhum: continua com o stack intacto.
    const seat = seatsTaken().find((entry) => entry.user?.id === leaving.id);
    expect(seat?.chips).toBe(1000);
    expect(seat?.inHand).toBe(false);

    unseatUser(TABLE_ID, third.id);
  });
});

describe('sair no meio da mão', () => {
  const players: AuthenticatedUser[] = [
    { id: 'user-saida-1', username: 'um' },
    { id: 'user-saida-2', username: 'dois' },
    { id: 'user-saida-3', username: 'tres' },
  ];

  const hand = () => getTableState(TABLE_ID)?.hand ?? null;

  const userOnTurn = () => {
    const state = getTableState(TABLE_ID)!;
    return state.seats.find((seat) => seat.seatIndex === state.hand?.turnSeat)?.user?.id ?? null;
  };

  const seatOfUser = (userId: string) =>
    getTableState(TABLE_ID)?.seats.find((seat) => seat.user?.id === userId) ?? null;

  const startWith = (count: number) => {
    for (const player of players.slice(0, count)) {
      seatUser(TABLE_ID, player, STACK);
      setReady(TABLE_ID, player.id, true);
    }
    startTableHand(TABLE_ID);
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    for (const player of players) {
      unseatUser(TABLE_ID, player.id);
    }
    vi.useRealTimers();
  });

  it('vale como desistir: a mão continua para os outros', () => {
    startWith(3);
    const leaving = userOnTurn()!;

    unseatUser(TABLE_ID, leaving);

    // A mão segue de pé, com a vez passada para o próximo.
    expect(hand()).not.toBeNull();
    expect(userOnTurn()).not.toBe(leaving);
    expect(userOnTurn()).not.toBeNull();
    // E o assento fica livre para outra pessoa sentar.
    expect(seatOfUser(leaving)).toBeNull();
  });

  it('a mesa ouve a saída como uma desistência', () => {
    startWith(3);
    const leaving = players.find((player) => player.id === userOnTurn())!;

    const result = unseatUser(TABLE_ID, leaving.id);

    expect(result?.folded).toMatchObject({
      username: leaving.username,
      action: 'fold',
      timedOut: false,
    });
  });

  it('não anuncia desistência de quem já tinha desistido', () => {
    startWith(3);
    const leaving = userOnTurn()!;
    applyPlayerAction(TABLE_ID, leaving, 'fold');

    expect(unseatUser(TABLE_ID, leaving)?.folded).toBeNull();
  });

  it('quem herda a vez ganha o prazo inteiro', () => {
    startWith(3);
    vi.advanceTimersByTime(TURN_TIMEOUT_MS - 3_000);

    unseatUser(TABLE_ID, userOnTurn()!);

    expect(hand()?.turnEndsInMs).toBe(TURN_TIMEOUT_MS);
  });

  it('o que ele já apostou fica no pote', () => {
    startWith(3);
    const potBefore = hand()!.pot;

    // Sai o small blind, que já tem fichas no pote.
    const smallBlind = getTableState(TABLE_ID)!.seats.find(
      (seat) => seat.seatIndex === hand()!.smallBlindSeat,
    )!.user!.id;
    unseatUser(TABLE_ID, smallBlind);

    expect(hand()?.pot).toBe(potBefore);
  });

  it('sobrando um, a mão acaba e o pote é dele', () => {
    startWith(2);
    const leaving = userOnTurn()!;
    const staying = players.find((player) => player.id !== leaving)!;

    const result = unseatUser(TABLE_ID, leaving);

    expect(result?.ended?.winners.map((winner) => winner.username)).toEqual([staying.username]);
    expect(hand()).toBeNull();
  });

  it('a saída de quem não tinha a vez não mexe no relógio de quem tem', () => {
    startWith(3);
    vi.advanceTimersByTime(5_000);

    const waiting = players.find((player) => player.id !== userOnTurn() && seatOfUser(player.id))!;
    unseatUser(TABLE_ID, waiting.id);

    // O relógio de quem está pensando não recomeça porque um vizinho levantou.
    expect(hand()?.turnEndsInMs).toBe(TURN_TIMEOUT_MS - 5_000);
  });
});

describe('fichas vindas da conta', () => {
  const player: AuthenticatedUser = { id: 'user-saldo-1', username: 'poupador' };
  const other: AuthenticatedUser = { id: 'user-saldo-2', username: 'gastador' };

  const seatOfUser = (userId: string) =>
    getTableState(TABLE_ID)?.seats.find((seat) => seat.user?.id === userId) ?? null;

  afterEach(() => {
    unseatUser(TABLE_ID, player.id);
    unseatUser(TABLE_ID, other.id);
  });

  it('senta com o saldo que o jogador trouxe, e não com um buy-in fixo', () => {
    seatUser(TABLE_ID, player, 350);

    expect(seatOfUser(player.id)?.chips).toBe(350);
  });

  it('sentar de novo não repõe fichas: valem as da mesa', () => {
    seatUser(TABLE_ID, player, 1000);
    setReady(TABLE_ID, player.id, true);
    seatUser(TABLE_ID, other, 1000);
    setReady(TABLE_ID, other.id, true);
    startTableHand(TABLE_ID);

    // Reconexão no meio da mão, com o saldo do banco ainda no que era antes dela.
    const staked = seatOfUser(player.id)!.chips;
    seatUser(TABLE_ID, player, 1000);

    expect(seatOfUser(player.id)?.chips).toBe(staked);
  });

  it('quem quebra não recompra sozinho ao ficar pronto', () => {
    seatUser(TABLE_ID, player, 0);

    setReady(TABLE_ID, player.id, true);

    expect(seatOfUser(player.id)?.chips).toBe(0);
  });

  it('devolve o stack de quem levanta, para voltar à conta', () => {
    seatUser(TABLE_ID, player, 725);

    expect(unseatUser(TABLE_ID, player.id)?.chips).toBe(725);
  });

  it('não devolve nada de quem nem estava sentado', () => {
    expect(unseatUser(TABLE_ID, player.id)?.chips).toBeNull();
  });

  it('aponta em que mesa o jogador está, para barrar a segunda', () => {
    expect(getSeatedTableId(player.id)).toBeNull();

    seatUser(TABLE_ID, player, 1000);

    expect(getSeatedTableId(player.id)).toBe(TABLE_ID);
  });
});
