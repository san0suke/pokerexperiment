import Phaser from 'phaser';
import type { TableState } from '@poker/shared';
import { getSocket } from '../services/socket-client.js';

interface TableSceneData {
  tableId: string;
}

/**
 * Placeholder poker table: renders seats around a felt oval and keeps them in sync
 * with the server. Cards, chips and betting controls come in the next phase.
 */
export class TableScene extends Phaser.Scene {
  private tableId!: string;
  private seatGroup!: Phaser.GameObjects.Container;
  private titleText!: Phaser.GameObjects.Text;

  constructor() {
    super('TableScene');
  }

  init(data: TableSceneData): void {
    this.tableId = data.tableId;
  }

  create(): void {
    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, 0x0b3d2e).setOrigin(0);
    this.add.ellipse(width / 2, height / 2, 720, 380, 0x14654c).setStrokeStyle(8, 0x5b3a1e);

    this.titleText = this.add.text(40, 30, 'Carregando mesa...', {
      fontSize: '28px',
      color: '#f5d47a',
      fontStyle: 'bold',
    });

    this.seatGroup = this.add.container(0, 0);

    const socket = getSocket();

    socket.on('table:state', (state) => this.renderTable(state));
    socket.on('server:error', (error) => {
      this.titleText.setText(error.message).setColor('#ff8a80');
    });

    socket.emit('table:join', { tableId: this.tableId }, (state) => {
      if (state) {
        this.renderTable(state);
      }
    });

    this.addLeaveButton(width, socket);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      socket.off('table:state');
      socket.off('server:error');
    });
  }

  private addLeaveButton(width: number, socket: ReturnType<typeof getSocket>): void {
    this.add
      .text(width - 40, 40, 'Voltar ao lobby', { fontSize: '18px', color: '#cfe8dd' })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => {
        socket.emit('table:leave', { tableId: this.tableId });
        this.scene.start('LobbyScene');
      });
  }

  private renderTable(state: TableState): void {
    this.titleText.setText(state.name).setColor('#f5d47a');
    this.seatGroup.removeAll(true);

    const centerX = this.scale.width / 2;
    const centerY = this.scale.height / 2;
    const radiusX = 400;
    const radiusY = 230;

    state.seats.forEach((seat, index) => {
      // Start at the bottom of the oval so seat 0 faces the player.
      const angle = Math.PI / 2 + (index / state.seats.length) * Math.PI * 2;
      const x = centerX + Math.cos(angle) * radiusX;
      const y = centerY + Math.sin(angle) * radiusY;

      const occupied = seat.user !== null;
      const circle = this.add
        .circle(x, y, 42, occupied ? 0x1f7a5c : 0x0e3f31)
        .setStrokeStyle(3, occupied ? 0xf5d47a : 0x2c5b4c);

      const label = this.add
        .text(x, y, occupied ? seat.user!.username : `Assento ${seat.seatIndex + 1}`, {
          fontSize: '14px',
          color: occupied ? '#ffffff' : '#7d9c90',
          align: 'center',
          wordWrap: { width: 78 },
        })
        .setOrigin(0.5);

      this.seatGroup.add([circle, label]);
    });
  }
}
