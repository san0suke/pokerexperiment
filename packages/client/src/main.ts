import Phaser from 'phaser';
import { gameConfig } from './config/game-config.js';
import { trackViewportHeight } from './services/viewport-height.js';

// Must run before the first scene lays out its DOM overlay.
trackViewportHeight();

new Phaser.Game(gameConfig);
