// Temporary end-to-end smoke test for the socket layer.
import { io } from 'socket.io-client';

const API = 'http://localhost:3000';

async function auth(username, email, password) {
  let res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password }),
  });
  if (!res.ok) {
    res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  }
  const data = await res.json();
  return data.token;
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = io(API, { auth: { token } });
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

// 7. Joining a table that does not exist.
const bogus = await new Promise((r) => alice.emit('table:join', { tableId: 'nope' }, r));
check('unknown table returns null', bogus === null);

// 8. Bob leaves; Alice gets player-left.
const aliceSawLeave = new Promise((r) => alice.once('table:player-left', r));
bob.emit('table:leave', { tableId: 'table-1' });
const leftUser = await aliceSawLeave;
check('alice notified of bob leaving', leftUser.username === 'bob');

// 9. Disconnect frees the seat.
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
