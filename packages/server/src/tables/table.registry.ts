import type { AuthenticatedUser, LobbyTableSummary, TableState } from '@poker/shared';

interface Table {
  id: string;
  name: string;
  maxSeats: number;
  smallBlind: number;
  bigBlind: number;
  /** seatIndex -> occupant. Hand/pot state lands here in a later phase. */
  seats: Map<number, AuthenticatedUser>;
}

const tables = new Map<string, Table>();

function seedTable(id: string, name: string, smallBlind: number, bigBlind: number): void {
  tables.set(id, { id, name, maxSeats: 6, smallBlind, bigBlind, seats: new Map() });
}

// Static tables for now; created/destroyed dynamically once the game loop exists.
seedTable('table-1', 'Mesa Iniciante', 5, 10);
seedTable('table-2', 'Mesa Intermediária', 25, 50);
seedTable('table-3', 'Mesa Alta', 100, 200);

export function listTables(): LobbyTableSummary[] {
  return [...tables.values()].map((table) => ({
    id: table.id,
    name: table.name,
    maxSeats: table.maxSeats,
    seatedCount: table.seats.size,
    smallBlind: table.smallBlind,
    bigBlind: table.bigBlind,
  }));
}

export function getTableState(tableId: string): TableState | null {
  const table = tables.get(tableId);
  if (!table) {
    return null;
  }
  return {
    id: table.id,
    name: table.name,
    maxSeats: table.maxSeats,
    seats: Array.from({ length: table.maxSeats }, (_, seatIndex) => ({
      seatIndex,
      user: table.seats.get(seatIndex) ?? null,
    })),
  };
}

/** Seats a user at the first free seat. Returns null if the table is missing or full. */
export function seatUser(tableId: string, user: AuthenticatedUser): TableState | null {
  const table = tables.get(tableId);
  if (!table) {
    return null;
  }

  const alreadySeated = [...table.seats.values()].some((seated) => seated.id === user.id);
  if (!alreadySeated) {
    const freeSeat = Array.from({ length: table.maxSeats }, (_, i) => i).find(
      (i) => !table.seats.has(i),
    );
    if (freeSeat === undefined) {
      return null;
    }
    table.seats.set(freeSeat, user);
  }

  return getTableState(tableId);
}

export function unseatUser(tableId: string, userId: string): TableState | null {
  const table = tables.get(tableId);
  if (!table) {
    return null;
  }
  for (const [seatIndex, seated] of table.seats) {
    if (seated.id === userId) {
      table.seats.delete(seatIndex);
      break;
    }
  }
  return getTableState(tableId);
}

/** Used on disconnect, when we don't know which table the socket was at. */
export function unseatUserEverywhere(userId: string): string[] {
  const affected: string[] = [];
  for (const table of tables.values()) {
    for (const [seatIndex, seated] of table.seats) {
      if (seated.id === userId) {
        table.seats.delete(seatIndex);
        affected.push(table.id);
        break;
      }
    }
  }
  return affected;
}
