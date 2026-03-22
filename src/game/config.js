import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { HUDScene } from './scenes/HUDScene';

export function createGameConfig(parent) {
    return {
        type: Phaser.AUTO,
        parent,
        width: '100%',
        height: '100%',
        backgroundColor: '#0a0e27',
        pixelArt: false,
        roundPixels: true,
        scale: {
            mode: Phaser.Scale.RESIZE,
            autoCenter: Phaser.Scale.CENTER_BOTH,
        },
        physics: {
            default: 'arcade',
            arcade: {
                gravity: { y: 0 },
                debug: false,
            },
        },
        scene: [BootScene, GameScene, HUDScene],
        input: {
            activePointers: 5,
        },
        render: {
            antialias: false,
            antialiasGL: false,
        },
    };
}
