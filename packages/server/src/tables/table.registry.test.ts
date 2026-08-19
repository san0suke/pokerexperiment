import { afterEach, describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '@poker/shared';
import {
  getTableState,
  markUserConnected,
  markUserDisconnected,
  seatUser,
  setReady,
  unseatUser,
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
