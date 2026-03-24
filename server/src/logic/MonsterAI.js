/**
 * MonsterAI — Server-side monster movement (plain JavaScript).
 * Monsters navigate the maze using sliding wall-collision.
 */
const TYPES = {
    zombie:  { health: 60,  speed: 2.9, damage: 8,  attackRate: 1000 },
    monster: { health: 40,  speed: 5.0, damage: 15, attackRate: 600  },
    ghost:   { health: 25,  speed: 4.4, damage: 5,  attackRate: 800  },
};

let mCounter = 0;

class MonsterAI {
    constructor(mazeData, gs) {
        this.mazeData = mazeData;
        this.gs = gs;
        this.worldW = mazeData.width  * mazeData.tileSize;
        this.worldH = mazeData.height * mazeData.tileSize;
        this._atkTimers = {};
    }

    spawnWave(count) {
        const typeList = ['zombie', 'monster', 'ghost'];
        for (let i = 0; i < count; i++) {
            const type = typeList[i % typeList.length];
            this.spawnOne(type);
        }
    }

    spawnOne(type) {
        const cfg  = TYPES[type];
        if (!cfg) {
            console.warn(`Attempted to spawn unknown monster type: ${type}`);
            return;
        }
        const pos  = this.getSpawnPos();
        const id   = `m${mCounter++}`;
        this.gs.monsters[id] = {
            id, type,
            x: pos.x, y: pos.y,
            health: cfg.health, maxHealth: cfg.health,
            alive: true,
        };
    }

    /**
     * Returns true if the world-space position (wx, wy) is inside a walkable tile.
     * Checks a small radius around the point (half-body = 10px) to avoid clipping.
     */
    _isWalkable(wx, wy) {
        const ts = this.mazeData.tileSize;
        const MARGIN = 10; // half-body size in pixels
        const points = [
            [wx - MARGIN, wy - MARGIN],
            [wx + MARGIN, wy - MARGIN],
            [wx - MARGIN, wy + MARGIN],
            [wx + MARGIN, wy + MARGIN],
        ];
        for (const [px, py] of points) {
            const gx = Math.floor(px / ts);
            const gy = Math.floor(py / ts);
            if (gx < 0 || gy < 0 || gx >= this.mazeData.width || gy >= this.mazeData.height) return false;
            if (this.mazeData.grid[gy][gx] !== 0) return false;
        }
        return true;
    }

    _buildPlayerDistanceMap(players) {
        const { width, height, grid } = this.mazeData;
        const distMap = Array(height).fill(null).map(() => Array(width).fill(Infinity));
        const queue = [];
        
        for (const p of players) {
            const tx = Math.floor(p.x / this.mazeData.tileSize);
            const ty = Math.floor(p.y / this.mazeData.tileSize);
            if (tx >= 0 && tx < width && ty >= 0 && ty < height && grid[ty][tx] === 0) { // Only add if player is on a walkable tile
                if (distMap[ty][tx] > 0) { // Avoid adding same tile multiple times if multiple players are on it
                    distMap[ty][tx] = 0;
                    queue.push({ x: tx, y: ty, d: 0 });
                }
            }
        }
        
        let head = 0;
        while (head < queue.length) {
            const curr = queue[head++];
            const neighbors = [
                {x: curr.x+1, y: curr.y}, {x: curr.x-1, y: curr.y},
                {x: curr.x, y: curr.y+1}, {x: curr.x, y: curr.y-1}
            ];
            for (const n of neighbors) {
                if (n.x >= 0 && n.x < width && n.y >= 0 && n.y < height && grid[n.y][n.x] === 0) {
                    if (distMap[n.y][n.x] > curr.d + 1) {
                        distMap[n.y][n.x] = curr.d + 1;
                        queue.push({ x: n.x, y: n.y, d: curr.d + 1 });
                    }
                }
            }
        }
        return distMap;
    }

    update(tickMs, players) {
        const alivePlayers = Object.values(players).filter(p => p.alive);
        if (!alivePlayers.length) return;

        // Build distance map once per update for all players
        this.distMapCache = this._buildPlayerDistanceMap(alivePlayers);

        for (const [id, m] of Object.entries(this.gs.monsters)) {
            if (!m.alive) continue;
            const cfg = TYPES[m.type] || TYPES['zombie'];

            // Nearest player
            let nearest = null, nearestD = Infinity;
            for (const p of alivePlayers) {
                const dx = p.x - m.x, dy = p.y - m.y;
                const d = dx*dx + dy*dy;
                if (d < nearestD) { nearestD = d; nearest = p; }
            }
            if (!nearest) continue;

            const dist = Math.sqrt(nearestD);
            const dx = nearest.x - m.x, dy = nearest.y - m.y;

            // Attack logic (separate from movement)
            if (dist < 28) {
                const now = Date.now();
                if (now - (this._atkTimers[id] || 0) >= cfg.attackRate) {
                    this._atkTimers[id] = now;
                    nearest.health -= cfg.damage;
                    if (nearest.health <= 0) {
                        nearest.health = 0;
                        nearest.alive = false;
                    }
                }
            }

            let moveX = 0, moveY = 0;

            if (m.type === 'ghost') {
                // Ghosts can fly directly through walls to nearest player
                const len = Math.max(dist, 0.001);
                moveX = (dx / len) * cfg.speed;
                moveY = (dy / len) * cfg.speed;
                m.x += moveX;
                m.y += moveY;
            } else {
                // Zombies and monsters follow BFS path
                const ts = this.mazeData.tileSize;
                const distMap = this.distMapCache;
                const mtx = Math.floor(m.x / ts);
                const mty = Math.floor(m.y / ts);
                
                if (distMap && mtx >= 0 && mty >= 0 && mtx < this.mazeData.width && mty < this.mazeData.height) {
                    const myDist = distMap[mty][mtx];
                    
                    if (myDist === 0 || myDist === Infinity) {
                        // Monster is on a player tile or unreachable, move directly towards nearest player
                        const len = Math.max(dist, 0.001);
                        moveX = (dx / len) * cfg.speed;
                        moveY = (dy / len) * cfg.speed;
                    } else {
                        // Find downhill neighbor
                        let bestD = myDist;
                        let bestNx = mtx, bestNy = mty;
                        const neighbors = [
                            {x: mtx+1, y: mty}, {x: mtx-1, y: mty},
                            {x: mtx, y: mty+1}, {x: mtx, y: mty-1}
                        ];
                        // Consider diagonal neighbors only if both cardinal paths are open
                        const diagNeighbors = [
                            {x: mtx+1, y: mty+1}, {x: mtx+1, y: mty-1},
                            {x: mtx-1, y: mty+1}, {x: mtx-1, y: mty-1}
                        ];

                        for (const n of neighbors) {
                            if (n.x >= 0 && n.x < this.mazeData.width && n.y >= 0 && n.y < this.mazeData.height) {
                                if (this.mazeData.grid[n.y][n.x] === 0 && distMap[n.y][n.x] < bestD) {
                                    bestD = distMap[n.y][n.x];
                                    bestNx = n.x; bestNy = n.y;
                                }
                            }
                        }
                        // Only consider diagonal if no better cardinal path was found
                        if (bestNx === mtx && bestNy === mty) {
                            for (const n of diagNeighbors) {
                                if (n.x >= 0 && n.x < this.mazeData.width && n.y >= 0 && n.y < this.mazeData.height) {
                                    // Check if both cardinal tiles leading to diagonal are walkable
                                    if (this.mazeData.grid[mty][n.x] === 0 && this.mazeData.grid[n.y][mtx] === 0) {
                                        if (this.mazeData.grid[n.y][n.x] === 0 && distMap[n.y][n.x] < bestD) {
                                            bestD = distMap[n.y][n.x];
                                            bestNx = n.x; bestNy = n.y;
                                        }
                                    }
                                }
                            }
                        }
                        
                        const targetX = bestNx * ts + ts / 2;
                        const targetY = bestNy * ts + ts / 2;
                        const tdx = targetX - m.x;
                        const tdy = targetY - m.y;
                        const tDist = Math.sqrt(tdx*tdx + tdy*tdy);
                        if (tDist > 2) { // Move only if not already very close to the center of the target tile
                            moveX = (tdx / tDist) * cfg.speed;
                            moveY = (tdy / tDist) * cfg.speed;
                        }
                    }
                } else {
                    // Fallback: if monster is outside grid or distMap is not ready, move directly
                    const len = Math.max(dist, 0.001);
                    moveX = (dx / len) * cfg.speed;
                    moveY = (dy / len) * cfg.speed;
                }
                
                const newX = m.x + moveX;
                const newY = m.y + moveY;

                // Sliding collision detection
                if (this._isWalkable(newX, newY)) {
                    m.x = newX; m.y = newY;
                } else if (this._isWalkable(newX, m.y)) {
                    m.x = newX;
                } else if (this._isWalkable(m.x, newY)) {
                    m.y = newY;
                }
            }

            // Clamp to world bounds
            m.x = Math.max(16, Math.min(m.x, this.worldW - 16));
            m.y = Math.max(16, Math.min(m.y, this.worldH - 16));
        }
    }

    getSpawnPos() {
        const { grid, width, height, tileSize } = this.mazeData;
        for (let i = 0; i < 80; i++) {
            const rx = Math.floor(Math.random() * (width  - 2)) + 1;
            const ry = Math.floor(Math.random() * (height - 2)) + 1;
            if (grid[ry]?.[rx] === 0) {
                return { x: rx * tileSize + tileSize / 2, y: ry * tileSize + tileSize / 2 };
            }
        }
        return { x: tileSize * 3, y: tileSize * 3 }; // Fallback spawn position
    }
}

module.exports = { MonsterAI };
