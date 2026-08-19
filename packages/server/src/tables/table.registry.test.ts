import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '@poker/shared';
import {
  applyPlayerAction,
  applyTurnTimeout,
  getTableState,
  getTurnDeadline,
  markUserConnected,
  markUserDisconnected,
  seatUser,
  setReady,
  startTableHand,
  unseatUser,
  TURN_TIMEOUT_MS,
} from './table.registry.js';

const TABLE_ID = 'table-1';
const user: AuthenticatedUser = { id: 'user-queda', username: 'quedinha' };

const seatOf = (userId: string) =>
  getTableState(TABLE_ID)?.seats.find((seat) => seat.user?.id === userId) ?? null;

// As mesas são um Map de módulo: o que um teste senta, ele tira.
afterEach(() => {
  unseatUser(TABLE_ID, user.id);
});

describe('queda e volta do jogador', () => {
  it('guarda o assento marcado como caído em vez de liberá-lo', () => {
    seatUser(TABLE_ID, user);

    expect(markUserDisconnected(user.id)).toEqual([TABLE_ID]);
    expect(seatOf(user.id)?.disconnected).toBe(true);
  });

  it('derruba o pronto de quem caiu, para a mão seguinte não começar sem ele', () => {
    seatUser(TABLE_ID, user);
    setReady(TABLE_ID, user.id, true);

    markUserDisconnected(user.id);

    expect(seatOf(user.id)?.ready).toBe(false);
  });

  it('reacende o assento quando o jogador volta', () => {
    seatUser(TABLE_ID, user);
    markUserDisconnected(user.id);

    expect(markUserConnected(user.id)).toEqual([TABLE_ID]);
    expect(seatOf(user.id)?.disconnected).toBe(false);
    // Segunda volta não tem o que reacender.
    expect(markUserConnected(user.id)).toEqual([]);
  });

  it('sentar de novo já vale como volta', () => {
    seatUser(TABLE_ID, user);
    markUserDisconnected(user.id);

    seatUser(TABLE_ID, user);

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
      seatUser(TABLE_ID, player);
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
