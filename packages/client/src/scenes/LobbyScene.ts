import Phaser from 'phaser';
import type { LobbyTableSummary } from '@poker/shared';
import { getSocket, disconnectSocket } from '../services/socket-client.js';
import { clearSession, getUser } from '../services/auth-storage.js';

export class LobbyScene extends Phaser.Scene {
  private tableRows: Phaser.GameObjects.Container[] = [];

  constructor() {
    super('LobbyScene');
  }

  create(): void {
    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, 0x0b3d2e).setOrigin(0);

    const user = getUser();
    this.add.text(40, 30, 'LOBBY', { fontSize: '40px', fontStyle: 'bold', color: '#f5d47a' });
    this.add.text(40, 80, `${user?.username ?? '?'} — ${user?.chips ?? 0} fichas`, {
      fontSize: '18px',
      color: '#cfe8dd',
    });

    this.addLogoutButton(width);

    const socket = getSocket();

    socket.on('connect_error', (error) => {
      // A rejected handshake almost always means the token expired.
      this.add.text(40, 150, `Erro de conexão: ${error.message}`, {
        fontSize: '16px',
        color: '#ff8a80',
      });
    });

    socket.on('lobby:tables-updated', (tables) => this.renderTables(tables));
    socket.emit('lobby:list-tables', (tables) => this.renderTables(tables));

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      socket.off('lobby:tables-updated');
      socket.off('connect_error');
    });
  }

  private addLogoutButton(width: number): void {
    this.add
      .text(width - 40, 40, 'Sair', { fontSize: '18px', color: '#cfe8dd' })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => {
        disconnectSocket();
        clearSession();
        this.scene.start('LoginScene');
      });
  }

  private renderTables(tables: LobbyTableSummary[]): void {
    this.tableRows.forEach((row) => row.destroy());
    this.tableRows = [];

    tables.forEach((table, index) => {
      const y = 160 + index * 90;
      const isFull = table.seatedCount >= table.maxSeats;

      const background = this.add
        .rectangle(0, 0, 640, 74, 0x134f3c)
        .setOrigin(0)
        .setStrokeStyle(2, 0x1e6b52);

      const title = this.add.text(16, 12, table.name, { fontSize: '22px', color: '#ffffff' });
      const details = this.add.text(
        16,
        42,
        `Blinds ${table.smallBlind}/${table.bigBlind} — ${table.seatedCount}/${table.maxSeats} jogadores`,
        { fontSize: '15px', color: '#a8ccbf' },
      );

      const action = this.add
        .text(600, 26, isFull ? 'Lotada' : 'Entrar', {
          fontSize: '20px',
          color: isFull ? '#7d9c90' : '#f5d47a',
          fontStyle: 'bold',
        })
        .setOrigin(1, 0);

      if (!isFull) {
        action.setInteractive({ useHandCursor: true }).on('pointerup', () => {
          this.scene.start('TableScene', { tableId: table.id });
        });
      }

      const row = this.add.container(40, y, [background, title, details, action]);
      this.tableRows.push(row);
    });
  }
}
