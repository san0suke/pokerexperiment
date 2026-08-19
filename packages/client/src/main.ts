import Phaser from 'phaser';
import { createGameConfig } from './config/game-config.js';
import { trackCanvasScale } from './services/canvas-scale.js';
import { trackViewportHeight } from './services/viewport-height.js';

// Must run before the first scene lays out its DOM overlay, and before the game
// measures the visible area for the first time.
trackViewportHeight();

const game = new Phaser.Game(createGameConfig());

// O canvas não se redimensiona sozinho no modo `NONE`: é este serviço que o
// mantém do tamanho da tela, na densidade certa.
trackCanvasScale(game);
