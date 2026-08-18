/** Identity attached to an authenticated socket, decoded from the JWT. */
export interface AuthenticatedUser {
  id: string;
  username: string;
}

/** A table as shown in the lobby list — no hand or hole-card data. */
export interface LobbyTableSummary {
  id: string;
  name: string;
  maxSeats: number;
  seatedCount: number;
  smallBlind: number;
  bigBlind: number;
}

export interface TableSeat {
  seatIndex: number;
  user: AuthenticatedUser | null;
}

/** Table state broadcast to everyone in the room. Grows into full game state in a later phase. */
export interface TableState {
  id: string;
  name: string;
  maxSeats: number;
  seats: TableSeat[];
}

export interface JoinTablePayload {
  tableId: string;
}

export interface LeaveTablePayload {
  tableId: string;
}

export interface SocketErrorPayload {
  code: string;
  message: string;
}
