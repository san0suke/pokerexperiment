import type {
  ActionTakenPayload,
  AuthenticatedUser,
  HandResultPayload,
  JoinTablePayload,
  LeaveTablePayload,
  LobbyTableSummary,
  PlayerActionPayload,
  PrivateHandState,
  SetReadyPayload,
  SocketErrorPayload,
  TableState,
} from './payloads.js';

/** Events the client emits to the server. Callbacks are Socket.IO acknowledgements. */
export interface ClientToServerEvents {
  'lobby:list-tables': (ack: (tables: LobbyTableSummary[]) => void) => void;
  'table:join': (payload: JoinTablePayload, ack: (state: TableState | null) => void) => void;
  'table:leave': (payload: LeaveTablePayload) => void;
  /** Marca/desmarca o jogador como pronto. A mão começa sozinha quando todos marcam. */
  'table:set-ready': (payload: SetReadyPayload) => void;
  /** Fold/check/call/raise. O servidor valida tudo; o cliente só sugere. */
  'hand:action': (payload: PlayerActionPayload) => void;
}

/** Events the server pushes to clients. */
export interface ServerToClientEvents {
  'lobby:tables-updated': (tables: LobbyTableSummary[]) => void;
  'table:state': (state: TableState) => void;
  'table:player-joined': (user: AuthenticatedUser) => void;
  'table:player-left': (user: AuthenticatedUser) => void;
  /** Cartas do próprio jogador. Emitido apenas para o socket dele. */
  'hand:private-state': (state: PrivateHandState) => void;
  /** O que cada jogador acabou de fazer, para a mesa acompanhar. */
  'hand:action-taken': (payload: ActionTakenPayload) => void;
  /** Fim da mão: quem levou o pote e, se houve showdown, as cartas abertas. */
  'hand:ended': (payload: HandResultPayload) => void;
  'server:error': (error: SocketErrorPayload) => void;
}

/** Reserved for multi-node scaling later (Redis adapter). */
export type InterServerEvents = Record<string, never>;

/** Per-socket server-side data, populated by the auth middleware. */
export interface SocketData {
  user: AuthenticatedUser;
}
