import { Schema, type, MapSchema, ArraySchema } from '@colyseus/core';

// ── Individual bullet ──
export class BulletState extends Schema {
    @type('number') x: number = 0;
    @type('number') y: number = 0;
    @type('number') vx: number = 0;
    @type('number') vy: number = 0;
    @type('number') damage: number = 10;
    @type('string') ownerId: string = '';
    @type('boolean') isExplosive: boolean = false;
}

// ── Monster (server-authoritative) ──
export class MonsterState extends Schema {
    @type('string') id: string = '';
    @type('string') type: string = 'zombie';
    @type('number') x: number = 0;
    @type('number') y: number = 0;
    @type('number') health: number = 60;
    @type('number') maxHealth: number = 60;
    @type('boolean') alive: boolean = true;
}

// ── Single player ──
export class PlayerState extends Schema {
    @type('string')  sessionId: string = '';
    @type('string')  uid: string = '';
    @type('string')  name: string = 'Player';
    @type('string')  team: string = 'none'; // 'red' | 'blue' | 'none'
    @type('number')  x: number = 0;
    @type('number')  y: number = 0;
    @type('number')  rotation: number = 0;
    @type('number')  health: number = 100;
    @type('number')  maxHealth: number = 100;
    @type('number')  keys: number = 0;
    @type('string')  weapon: string = '';   // '' | 'M4' | 'BAZOOKA'
    @type('boolean') alive: boolean = true;
    @type('boolean') ready: boolean = false;
    @type('number')  kills: number = 0;
    @type('number')  tint: number = 0xffffff;
}

// ── Full game state ──
export class GameState extends Schema {
    @type('string')  mode: string = 'war';     // '1v1' | 'squad' | 'war'
    @type('string')  phase: string = 'waiting'; // 'waiting' | 'playing' | 'ended'
    @type('string')  winner: string = '';       // uid / team / ''
    @type('number')  mazeSeed: number = 0;
    @type('string')  hostId: string = '';
    @type('number')  serverTick: number = 0;

    @type({ map: PlayerState })
    players = new MapSchema<PlayerState>();

    @type({ map: MonsterState })
    monsters = new MapSchema<MonsterState>();

    @type([BulletState])
    bullets = new ArraySchema<BulletState>();
}
