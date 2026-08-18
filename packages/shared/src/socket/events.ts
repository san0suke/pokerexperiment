import type {
  AuthenticatedUser,
  JoinTablePayload,
  LeaveTablePayload,
  LobbyTableSummary,
  SocketErrorPayload,
  TableState,
} from './payloads.js';

/** Events the client emits to the server. Callbacks are Socket.IO acknowledgements. */
export interface ClientToServerEvents {
  'lobby:list-tables': (ack: (tables: LobbyTableSummary[]) => void) => void;
  'table:join': (payload: JoinTablePayload, ack: (state: TableState | null) => void) => void;
  'table:leave': (payload: LeaveTablePayload) => void;
}

/** Events the server pushes to clients. */
export interface ServerToClientEvents {
  'lobby:tables-updated': (tables: LobbyTableSummary[]) => void;
  'table:state': (state: TableState) => void;
  'table:player-joined': (user: AuthenticatedUser) => void;
  'table:player-left': (user: AuthenticatedUser) => void;
  'server:error': (error: SocketErrorPayload) => void;
}

/** Reserved for multi-node scaling later (Redis adapter). */
export type InterServerEvents = Record<string, never>;

/** Per-socket server-side data, populated by the auth middleware. */
export interface SocketData {
  user: AuthenticatedUser;
}
