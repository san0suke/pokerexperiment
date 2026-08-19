// Temporary end-to-end smoke test for the socket layer.
import { io } from 'socket.io-client';

// Point at a LAN/Tailscale address to verify the game really is reachable from
// other devices: SMOKE_API=http://192.168.0.190:3000 npm run smoke -w @poker/server
const API = process.env.SMOKE_API || 'http://localhost:3000';
// Browsers always send Origin; mimic it so the CORS path is exercised too.
const ORIGIN = process.env.SMOKE_ORIGIN || API.replace(/:\d+$/, ':5173');

async function auth(username, email, password) {
  let res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ username, email, password }),
  });
  if (!res.ok) {
    res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ username, password }),
    });
  }
  const data = await res.json();
  return data.token;
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = io(API, { auth: { token }, extraHeaders: { Origin: ORIGIN } });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => reject(err));
  });
}

const results = [];
const check = (name, pass, extra = '') =>
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);

// 1. Handshake must reject a bad token.
try {
  await connect('garbage-token');
  check('rejects invalid JWT', false, 'connection was accepted');
} catch (err) {
  check('rejects invalid JWT', true, err.message);
}

// 2. Handshake must reject a missing token.
try {
  await connect('');
  check('rejects missing JWT', false, 'connection was accepted');
} catch (err) {
  check('rejects missing JWT', true, err.message);
}

// 3. Two authenticated clients.
const tokenA = await auth('alice', 'alice@example.com', 'secret123');
const tokenB = await auth('bob', 'bob@example.com', 'secret123');
const alice = await connect(tokenA);
const bob = await connect(tokenB);
check('accepts valid JWT (2 clients)', alice.connected && bob.connected);

// 4. Lobby listing.
const tables = await new Promise((r) => alice.emit('lobby:list-tables', r));
check('lobby lists tables', tables.length === 3, `${tables.length} tables`);
check('tables start empty', tables.every((t) => t.seatedCount === 0));

// 5. Alice joins; Bob should be notified via the lobby broadcast.
const lobbyUpdate = new Promise((r) => bob.once('lobby:tables-updated', r));
const stateA = await new Promise((r) => alice.emit('table:join', { tableId: 'table-1' }, r));
check('join returns table state', stateA !== null && stateA.id === 'table-1');
check('alice is seated', stateA?.seats.some((s) => s.user?.username === 'alice'));

const updated = await lobbyUpdate;
check(
  'lobby broadcast reflects the new seat',
  updated.find((t) => t.id === 'table-1')?.seatedCount === 1,
);

// 6. Bob joins the same table; Alice gets player-joined + state.
const aliceSawJoin = new Promise((r) => alice.once('table:player-joined', r));
const stateB = await new Promise((r) => bob.emit('table:join', { tableId: 'table-1' }, r));
check('both players seated', stateB?.seats.filter((s) => s.user !== null).length === 2);
const joinedUser = await aliceSawJoin;
check('alice notified of bob joining', joinedUser.username === 'bob');
check(
  'everyone buys in with 1000 chips',
  stateB?.seats.filter((s) => s.user !== null).every((s) => s.chips === 1000),
);

// 7. Joining a table that does not exist.
const bogus = await new Promise((r) => alice.emit('table:join', { tableId: 'nope' }, r));
check('unknown table returns null', bogus === null);

// 8. Ready check: the hand only starts once everyone at the table is ready.
const waitForState = (socket, predicate, timeoutMs = 5000) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off('table:state', handler);
      resolve(null);
    }, timeoutMs);
    function handler(state) {
      if (predicate(state)) {
        clearTimeout(timer);
        socket.off('table:state', handler);
        resolve(state);
      }
    }
    socket.on('table:state', handler);
  });

const aliceReady = waitForState(bob, (s) => s.seats.some((seat) => seat.user?.username === 'alice' && seat.ready));
alice.emit('table:set-ready', { tableId: 'table-1', ready: true });
const afterOneReady = await aliceReady;
check('ready flag is broadcast to the room', afterOneReady !== null);
check('one ready player does not start the hand', afterOneReady?.status === 'waiting');

const aliceCards = new Promise((r) => alice.once('hand:private-state', r));
const bobCards = new Promise((r) => bob.once('hand:private-state', r));
const handStarted = waitForState(alice, (s) => s.status === 'playing');
bob.emit('table:set-ready', { tableId: 'table-1', ready: true });

const playing = await handStarted;
check('hand starts when everyone is ready', playing !== null);
check('blinds are posted', playing?.hand?.pot === 15, `pot ${playing?.hand?.pot}`);
check(
  'blinds come out of the stacks',
  playing?.seats.find((s) => s.seatIndex === playing.hand.smallBlindSeat)?.chips === 995 &&
    playing?.seats.find((s) => s.seatIndex === playing.hand.bigBlindSeat)?.chips === 990,
);
check(
  'heads-up: the dealer is the small blind',
  playing?.hand?.dealerSeat === playing?.hand?.smallBlindSeat &&
    playing?.hand?.bigBlindSeat !== playing?.hand?.dealerSeat,
);
check('ready resets for the next hand', playing?.seats.every((s) => !s.ready));
check('both players are in the hand', playing?.seats.filter((s) => s.inHand).length === 2);

// Nada com cara de carta pode chegar à sala além do que está aberto na mesa.
const visibleCards = (state) => (JSON.stringify(state).match(/"suit"/g) || []).length;
check('public state leaks no cards before the flop', visibleCards(playing) === 0);

const [aliceHole, bobHole] = await Promise.all([aliceCards, bobCards]);
check('each player gets two hole cards', aliceHole.holeCards.length === 2 && bobHole.holeCards.length === 2);
const dealt = new Set(
  [...aliceHole.holeCards, ...bobHole.holeCards].map((c) => `${c.rank}${c.suit}`),
);
check('hole cards are all different', dealt.size === 4);
check('players get different hands', aliceHole.seatIndex !== bobHole.seatIndex);

// 9. A full hand: fold/check/call rules, community cards and showdown.
const socketBySeat = { [aliceHole.seatIndex]: alice, [bobHole.seatIndex]: bob };
const tableId = 'table-1';

const nextState = (socket = alice) => new Promise((r) => socket.once('table:state', r));
const actAndWait = (seatIndex, action, amount) => {
  const settled = nextState();
  socketBySeat[seatIndex].emit('hand:action', { tableId, action, amount });
  return settled;
};

// Quem não tem a vez não age.
const outOfTurn = new Promise((r) => {
  const timer = setTimeout(() => r(null), 3000);
  const waiter = playing.hand.turnSeat === aliceHole.seatIndex ? bob : alice;
  waiter.once('server:error', (err) => {
    clearTimeout(timer);
    r(err);
  });
});
(playing.hand.turnSeat === aliceHole.seatIndex ? bob : alice).emit('hand:action', {
  tableId,
  action: 'check',
});
check('acting out of turn is refused', (await outOfTurn) !== null);

// Com aposta na frente não dá para passar: paga ou desiste.
const mustCall = new Promise((r) => {
  const timer = setTimeout(() => r(null), 3000);
  socketBySeat[playing.hand.turnSeat].once('server:error', (err) => {
    clearTimeout(timer);
    r(err);
  });
});
socketBySeat[playing.hand.turnSeat].emit('hand:action', { tableId, action: 'check' });
const refusedCheck = await mustCall;
check('cannot check facing a bet', refusedCheck !== null, refusedCheck?.message ?? 'timed out');

let handEnded = null;
alice.once('hand:ended', (payload) => {
  handEnded = payload;
});

let state = playing;
const roundsSeen = new Set([state.hand.round]);
let boardAtFlop = -1;
let guard = 0;

while (state.status === 'playing' && state.hand?.turnSeat !== null && guard < 24) {
  guard += 1;
  const turn = state.hand.turnSeat;
  const seat = state.seats.find((s) => s.seatIndex === turn);
  const action = seat.bet < state.hand.currentBet ? 'call' : 'check';
  state = await actAndWait(turn, action);

  if (state.hand) {
    roundsSeen.add(state.hand.round);
    if (state.hand.round === 'flop' && boardAtFlop === -1) {
      boardAtFlop = state.hand.communityCards.length;
      check('the flop opens three community cards', boardAtFlop === 3);
      check('the flop is public, and nothing else is', visibleCards(state) === 3);
    }
  }
}

check('every street was played', ['preflop', 'flop', 'turn', 'river'].every((r) => roundsSeen.has(r)));
check('the hand ended', handEnded !== null);
check('showdown reveals both hands', handEnded?.showdown.length === 2);
check('showdown names the made hand', Boolean(handEnded?.showdown[0]?.description));
check('the winner is named', Boolean(handEnded?.winners[0]?.username));
check('pot equals the two big blinds', handEnded?.pot === 20, `pot ${handEnded?.pot}`);
check('table returns to waiting', state.status === 'waiting');
check('chips are conserved', state.seats.filter((s) => s.user).reduce((sum, s) => sum + s.chips, 0) === 2000);

// 10. Second hand: the blinds move, and leaving mid-hand hands the pot over.
const firstDealer = playing.hand.dealerSeat;
const secondHand = waitForState(alice, (s) => s.status === 'playing');
alice.emit('table:set-ready', { tableId, ready: true });
bob.emit('table:set-ready', { tableId, ready: true });
const replay = await secondHand;
check('a second hand starts after both are ready again', replay !== null);
check('the button moved to the other player', replay?.hand?.dealerSeat !== firstDealer);
check('blinds are posted again', replay?.hand?.pot === 15);

const aliceWinsByWalkover = new Promise((r) => {
  const timer = setTimeout(() => r(null), 5000);
  alice.once('hand:ended', (payload) => {
    clearTimeout(timer);
    r(payload);
  });
});
const aliceSawLeave = new Promise((r) => alice.once('table:player-left', r));
bob.emit('table:leave', { tableId });
const leftUser = await aliceSawLeave;
check('alice notified of bob leaving', leftUser.username === 'bob');
const walkover = await aliceWinsByWalkover;
check('leaving mid-hand folds and ends the hand', walkover !== null);
check('the pot goes to the player still in', walkover?.winners[0]?.username === 'alice');
check('no showdown when everyone else folded', walkover?.showdown.length === 0);

// 11. Disconnect frees the seat.
// Wait for the specific condition, not the first broadcast — bob's own `table:leave`
// broadcast may still be in flight and would otherwise be mistaken for this one.
const seatFreed = new Promise((resolve) => {
  const timer = setTimeout(() => resolve(null), 5000);
  bob.on('lobby:tables-updated', function handler(tables) {
    if (tables.find((t) => t.id === 'table-1')?.seatedCount === 0) {
      clearTimeout(timer);
      bob.off('lobby:tables-updated', handler);
      resolve(tables);
    }
  });
});
alice.disconnect();
const afterDisconnect = await seatFreed;
check('disconnect frees the seat', afterDisconnect !== null, afterDisconnect ? '' : 'timed out');

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);

alice.disconnect();
bob.disconnect();
process.exit(failed === 0 ? 0 : 1);
