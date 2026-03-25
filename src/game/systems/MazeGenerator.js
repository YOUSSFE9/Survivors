/**
 * MazeGenerator — Procedural space station maze using recursive backtracker.
 * Generates a grid-based maze with rooms, corridors, and spawn points.
 */

const TILE = {
    FLOOR: 0,
    WALL: 1,
    SPAWN: 2,
    KEY_SPAWN: 3,
    PICKUP_SPAWN: 4,
    ENEMY_SPAWN: 5,
    TRAP_SPAWN: 6,
};

export { TILE };

export class MazeGenerator {
    constructor(cols = 30, rows = 30, cellSize = 3, seed = null) {
        this.cols = cols;
        this.rows = rows;
        this.cellSize = cellSize;
        this.mapWidth = cols * cellSize + 1;
        this.mapHeight = rows * cellSize + 1;
        this.grid = [];
        this.keyPositions = [];
        this.pickupPositions = [];
        this.enemyPositions = [];
        this.trapPositions = [];
        this.playerSpawn = { x: 0, y: 0 };
        this.rooms = [];

        // Seeded PRNG (mulberry32) — if no seed provided, use Date.now()
        this._seed = seed ?? Date.now();
        let s = this._seed | 0;
        this._rng = () => {
            s |= 0; s = s + 0x6D2B79F5 | 0;
            let t = Math.imul(s ^ s >>> 15, 1 | s);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    // Use this instead of Math.random()
    random() { return this._rng(); }

    generate() {
        // Initialize all as walls
        this.grid = Array.from({ length: this.mapHeight }, () =>
            Array.from({ length: this.mapWidth }, () => TILE.WALL)
        );

        // Maze cells for recursive backtracker
        const visited = Array.from({ length: this.rows }, () =>
            Array.from({ length: this.cols }, () => false)
        );

        const stack = [];
        const startCellX = 0;
        const startCellY = 0;
        visited[startCellY][startCellX] = true;
        stack.push({ x: startCellX, y: startCellY });

        // Carve starting cell
        this._carveCell(startCellX, startCellY);

        // Recursive backtracker
        while (stack.length > 0) {
            const current = stack[stack.length - 1];
            const neighbors = this._getUnvisitedNeighbors(current.x, current.y, visited);

            if (neighbors.length === 0) {
                stack.pop();
            } else {
                const next = neighbors[Math.floor(this.random() * neighbors.length)];
                visited[next.y][next.x] = true;
                this._carvePassage(current.x, current.y, next.x, next.y);
                this._carveCell(next.x, next.y);
                stack.push(next);
            }
        }

        // Create open rooms at random positions for better gameplay
        this._createRooms(8);

        // Set spawn points
        this._setSpawnPoints();

        return {
            grid: this.grid,
            width: this.mapWidth,
            height: this.mapHeight,
            playerSpawn: this.playerSpawn,
            keyPositions: this.keyPositions,
            pickupPositions: this.pickupPositions,
            enemyPositions: this.enemyPositions,
            trapPositions: this.trapPositions,
            rooms: this.rooms,
        };
    }

    _carveCell(cx, cy) {
        const sx = cx * this.cellSize + 1;
        const sy = cy * this.cellSize + 1;
        for (let dy = 0; dy < this.cellSize - 1; dy++) {
            for (let dx = 0; dx < this.cellSize - 1; dx++) {
                if (sy + dy < this.mapHeight && sx + dx < this.mapWidth) {
                    this.grid[sy + dy][sx + dx] = TILE.FLOOR;
                }
            }
        }
    }

    _carvePassage(cx1, cy1, cx2, cy2) {
        const sx1 = cx1 * this.cellSize + 1;
        const sy1 = cy1 * this.cellSize + 1;
        const sx2 = cx2 * this.cellSize + 1;
        const sy2 = cy2 * this.cellSize + 1;

        if (cx1 === cx2) {
            // Vertical passage
            const startY = Math.min(sy1, sy2);
            const endY = Math.max(sy1, sy2) + this.cellSize - 2;
            for (let y = startY; y <= endY && y < this.mapHeight; y++) {
                for (let dx = 0; dx < this.cellSize - 1; dx++) {
                    if (sx1 + dx < this.mapWidth) {
                        this.grid[y][sx1 + dx] = TILE.FLOOR;
                    }
                }
            }
        } else {
            // Horizontal passage
            const startX = Math.min(sx1, sx2);
            const endX = Math.max(sx1, sx2) + this.cellSize - 2;
            for (let x = startX; x <= endX && x < this.mapWidth; x++) {
                for (let dy = 0; dy < this.cellSize - 1; dy++) {
                    if (sy1 + dy < this.mapHeight) {
                        this.grid[sy1 + dy][x] = TILE.FLOOR;
                    }
                }
            }
        }
    }

    _getUnvisitedNeighbors(cx, cy, visited) {
        const neighbors = [];
        const dirs = [
            { x: 0, y: -1 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
            { x: -1, y: 0 },
        ];
        for (const d of dirs) {
            const nx = cx + d.x;
            const ny = cy + d.y;
            if (nx >= 0 && nx < this.cols && ny >= 0 && ny < this.rows && !visited[ny][nx]) {
                neighbors.push({ x: nx, y: ny });
            }
        }
        return neighbors;
    }

    _createRooms(count) {
        for (let i = 0; i < count; i++) {
            const roomW = 4 + Math.floor(this.random() * 4);
            const roomH = 4 + Math.floor(this.random() * 4);
            const rx = 2 + Math.floor(this.random() * (this.mapWidth - roomW - 4));
            const ry = 2 + Math.floor(this.random() * (this.mapHeight - roomH - 4));

            for (let y = ry; y < ry + roomH && y < this.mapHeight; y++) {
                for (let x = rx; x < rx + roomW && x < this.mapWidth; x++) {
                    this.grid[y][x] = TILE.FLOOR;
                }
            }
            this.rooms.push({ x: rx, y: ry, w: roomW, h: roomH });
        }
    }

    _setSpawnPoints() {
        const floors = [];
        for (let y = 0; y < this.mapHeight; y++) {
            for (let x = 0; x < this.mapWidth; x++) {
                if (this.grid[y][x] === TILE.FLOOR) {
                    floors.push({ x, y });
                }
            }
        }

        // Shuffle floors
        for (let i = floors.length - 1; i > 0; i--) {
            const j = Math.floor(this.random() * (i + 1));
            [floors[i], floors[j]] = [floors[j], floors[i]];
        }

        let idx = 0;

        // Player spawn
        if (floors.length > 0) {
            this.playerSpawn = floors[idx++];
            this.grid[this.playerSpawn.y][this.playerSpawn.x] = TILE.SPAWN;
        }

        // 10 key positions
        for (let i = 0; i < 10 && idx < floors.length; i++) {
            this.keyPositions.push(floors[idx]);
            this.grid[floors[idx].y][floors[idx].x] = TILE.KEY_SPAWN;
            idx++;
        }

        // 15 pickup positions (health kits, ammo, weapons)
        for (let i = 0; i < 15 && idx < floors.length; i++) {
            this.pickupPositions.push(floors[idx]);
            this.grid[floors[idx].y][floors[idx].x] = TILE.PICKUP_SPAWN;
            idx++;
        }

        // 20 enemy spawn positions
        for (let i = 0; i < 20 && idx < floors.length; i++) {
            this.enemyPositions.push(floors[idx]);
            this.grid[floors[idx].y][floors[idx].x] = TILE.ENEMY_SPAWN;
            idx++;
        }

        // 20 trap positions
        for (let i = 0; i < 20 && idx < floors.length; i++) {
            this.trapPositions.push(floors[idx]);
            this.grid[floors[idx].y][floors[idx].x] = TILE.TRAP_SPAWN;
            idx++;
        }
    }

    getFloorTiles() {
        const floors = [];
        for (let y = 0; y < this.mapHeight; y++) {
            for (let x = 0; x < this.mapWidth; x++) {
                if (this.grid[y][x] !== TILE.WALL) {
                    floors.push({ x, y });
                }
            }
        }
        return floors;
    }

    getRandomFloor() {
        const floors = this.getFloorTiles();
        return floors[Math.floor(this.random() * floors.length)];
    }

    /**
     * Generate maze using SAME algorithm as server — must produce identical grid.
     * Uses LCG PRNG + recursive backtracker with cellSize=3 (2-wide corridors).
     * Matches server/src/logic/MazeGenerator.js exactly.
     */
    static _generateOnlineLegacyA(w, h, scale, seed) {
        const width  = w * scale + 1;
        const height = h * scale + 1;
        const grid = Array.from({ length: height }, () => new Array(width).fill(1));

        // Same LCG as server
        let s = seed >>> 0;
        const rng = () => {
            s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
            return s / 0xffffffff;
        };

        const visited = Array.from({ length: h }, () => new Array(w).fill(false));

        function carveCell(cx, cy) {
            const sx = cx * scale + 1, sy = cy * scale + 1;
            for (let dy = 0; dy < scale - 1; dy++)
                for (let dx = 0; dx < scale - 1; dx++)
                    if (sy + dy < height && sx + dx < width)
                        grid[sy + dy][sx + dx] = 0;
        }

        function carvePassage(cx1, cy1, cx2, cy2) {
            const sx1 = cx1 * scale + 1, sy1 = cy1 * scale + 1;
            const sx2 = cx2 * scale + 1, sy2 = cy2 * scale + 1;
            if (cx1 === cx2) {
                const startY = Math.min(sy1, sy2);
                const endY   = Math.max(sy1, sy2) + scale - 2;
                for (let y = startY; y <= endY && y < height; y++)
                    for (let dx = 0; dx < scale - 1; dx++)
                        if (sx1 + dx < width) grid[y][sx1 + dx] = 0;
            } else {
                const startX = Math.min(sx1, sx2);
                const endX   = Math.max(sx1, sx2) + scale - 2;
                for (let x = startX; x <= endX && x < width; x++)
                    for (let dy = 0; dy < scale - 1; dy++)
                        if (sy1 + dy < height) grid[sy1 + dy][x] = 0;
            }
        }

        function shuffle(arr) {
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            return arr;
        }

        function dfs(cx, cy) {
            visited[cy][cx] = true;
            carveCell(cx, cy);
            const dirs = shuffle([[0,-1],[1,0],[0,1],[-1,0]]);
            for (const [ddx, ddy] of dirs) {
                const nx = cx + ddx, ny = cy + ddy;
                if (nx >= 0 && nx < w && ny >= 0 && ny < h && !visited[ny][nx]) {
                    carvePassage(cx, cy, nx, ny);
                    dfs(nx, ny);
                }
            }
        }
        dfs(0, 0);

        // Collect and shuffle floor tiles
        const floors = [];
        for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++)
                if (grid[y][x] === 0) floors.push({ x, y });
        shuffle(floors);

        let idx = 0;
        const playerSpawn   = floors[idx++] || { x: 1, y: 1 };
        const keyPositions  = [];
        for (let i = 0; i < 10 && idx < floors.length; i++) keyPositions.push(floors[idx++]);
        const pickupPositions = [];
        for (let i = 0; i < 15 && idx < floors.length; i++) pickupPositions.push(floors[idx++]);
        const enemyPositions = [];
        for (let i = 0; i < 20 && idx < floors.length; i++) enemyPositions.push(floors[idx++]);
        const trapPositions = [];
        for (let i = 0; i < 20 && idx < floors.length; i++) trapPositions.push(floors[idx++]);

        return { grid, width, height, tileSize: 32, playerSpawn, keyPositions, pickupPositions, enemyPositions, trapPositions, rooms: [] };
    }

    /**
     * generateOnline — Static method that produces the EXACT same maze as the server.
     * Must be byte-for-byte identical to server/src/logic/MazeGenerator.js generate().
     * Same seed → same maze on all clients and server.
     */
    static generateOnline(w, h, scale, seed, serverGrid = null) {
        const width  = w * scale + 1;
        const height = h * scale + 1;
        const tileSize = 32;
        let grid = serverGrid;

        if (!grid) {
            grid = Array.from({ length: height }, () => new Array(width).fill(1));
        }

        // Simple seeded LCG RNG — must match server exactly
        let s = seed >>> 0;
        const rng = () => {
            s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
            return s / 0xffffffff;
        };

        const visited = Array.from({ length: h }, () => new Array(w).fill(false));

        function carveCell(cx, cy) {
            const sx = cx * scale + 1;
            const sy = cy * scale + 1;
            for (let dy = 0; dy < scale - 1; dy++)
                for (let dx = 0; dx < scale - 1; dx++)
                    if (sy + dy < height && sx + dx < width)
                        grid[sy + dy][sx + dx] = 0;
        }

        function carvePassage(cx1, cy1, cx2, cy2) {
            const sx1 = cx1 * scale + 1, sy1 = cy1 * scale + 1;
            const sx2 = cx2 * scale + 1, sy2 = cy2 * scale + 1;
            if (cx1 === cx2) {
                const startY = Math.min(sy1, sy2);
                const endY   = Math.max(sy1, sy2) + scale - 2;
                for (let y = startY; y <= endY && y < height; y++)
                    for (let dx = 0; dx < scale - 1; dx++)
                        if (sx1 + dx < width) grid[y][sx1 + dx] = 0;
            } else {
                const startX = Math.min(sx1, sx2);
                const endX   = Math.max(sx1, sx2) + scale - 2;
                for (let x = startX; x <= endX && x < width; x++)
                    for (let dy = 0; dy < scale - 1; dy++)
                        if (sy1 + dy < height) grid[sy1 + dy][x] = 0;
            }
        }

        function shuffle(arr) {
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            return arr;
        }

        function dfs(cx, cy) {
            visited[cy][cx] = true;
            carveCell(cx, cy);
            const dirs = shuffle([[0,-1],[1,0],[0,1],[-1,0]]);
            for (const [ddx, ddy] of dirs) {
                const nx = cx + ddx, ny = cy + ddy;
                if (nx >= 0 && nx < w && ny >= 0 && ny < h && !visited[ny][nx]) {
                    carvePassage(cx, cy, nx, ny);
                    dfs(nx, ny);
                }
            }
        }
        
        if (!serverGrid) {
            dfs(0, 0);
        }

        // Collect floor tiles for spawn positions
        const floors = [];
        for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++)
                if (grid[y][x] === 0) floors.push({ x, y });

        shuffle(floors);

        let idx = 0;
        const playerSpawn   = floors[idx++] || { x: 1, y: 1 };
        const keyPositions  = [];
        for (let i = 0; i < 10 && idx < floors.length; i++) keyPositions.push(floors[idx++]);
        const pickupPositions = [];
        for (let i = 0; i < 15 && idx < floors.length; i++) pickupPositions.push(floors[idx++]);
        const enemyPositions = [];
        for (let i = 0; i < 20 && idx < floors.length; i++) enemyPositions.push(floors[idx++]);
        const trapPositions = [];
        for (let i = 0; i < 20 && idx < floors.length; i++) trapPositions.push(floors[idx++]);

        return {
            grid, width, height, tileSize,
            playerSpawn, keyPositions, pickupPositions, enemyPositions, trapPositions, rooms: [],
        };
    }

    /**
     * Generates an online maze using the EXACT same algorithm as the server
     * (LCG RNG + recursive DFS backtracker). Identical seed → identical map.
     * Must stay in sync with server/src/logic/MazeGenerator.js
     */
    static _generateOnlineLegacyB(w = 20, h = 20, scale = 3, seed = 0) {
        const width  = w * scale + 1;
        const height = h * scale + 1;
        const tileSize = 32;
        const grid = Array.from({ length: height }, () => new Array(width).fill(1));

        // Same LCG RNG as server
        let s = seed >>> 0;
        const rng = () => {
            s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
            return s / 0xffffffff;
        };

        const visited = Array.from({ length: h }, () => new Array(w).fill(false));

        function carveCell(cx, cy) {
            const sx = cx * scale + 1;
            const sy = cy * scale + 1;
            for (let dy = 0; dy < scale - 1; dy++)
                for (let dx = 0; dx < scale - 1; dx++)
                    if (sy + dy < height && sx + dx < width)
                        grid[sy + dy][sx + dx] = 0;
        }

        function carvePassage(cx1, cy1, cx2, cy2) {
            const sx1 = cx1 * scale + 1, sy1 = cy1 * scale + 1;
            const sx2 = cx2 * scale + 1, sy2 = cy2 * scale + 1;
            if (cx1 === cx2) {
                const startY = Math.min(sy1, sy2);
                const endY   = Math.max(sy1, sy2) + scale - 2;
                for (let y = startY; y <= endY && y < height; y++)
                    for (let dx = 0; dx < scale - 1; dx++)
                        if (sx1 + dx < width) grid[y][sx1 + dx] = 0;
            } else {
                const startX = Math.min(sx1, sx2);
                const endX   = Math.max(sx1, sx2) + scale - 2;
                for (let x = startX; x <= endX && x < width; x++)
                    for (let dy = 0; dy < scale - 1; dy++)
                        if (sy1 + dy < height) grid[sy1 + dy][x] = 0;
            }
        }

        function shuffle(arr) {
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            return arr;
        }

        function dfs(cx, cy) {
            visited[cy][cx] = true;
            carveCell(cx, cy);
            const dirs = shuffle([[0,-1],[1,0],[0,1],[-1,0]]);
            for (const [ddx, ddy] of dirs) {
                const nx = cx + ddx, ny = cy + ddy;
                if (nx >= 0 && nx < w && ny >= 0 && ny < h && !visited[ny][nx]) {
                    carvePassage(cx, cy, nx, ny);
                    dfs(nx, ny);
                }
            }
        }
        dfs(0, 0);

        const floors = [];
        for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++)
                if (grid[y][x] === 0) floors.push({ x, y });

        shuffle(floors);

        let idx = 0;
        const playerSpawn   = floors[idx++] || { x: 1, y: 1 };
        const keyPositions  = [];
        for (let i = 0; i < 10 && idx < floors.length; i++) keyPositions.push(floors[idx++]);
        const pickupPositions = [];
        for (let i = 0; i < 15 && idx < floors.length; i++) pickupPositions.push(floors[idx++]);
        const enemyPositions = [];
        for (let i = 0; i < 20 && idx < floors.length; i++) enemyPositions.push(floors[idx++]);
        const trapPositions = [];
        for (let i = 0; i < 20 && idx < floors.length; i++) trapPositions.push(floors[idx++]);

        return {
            grid, width, height, tileSize,
            playerSpawn, keyPositions, pickupPositions, enemyPositions, trapPositions, rooms: [],
        };
    }
}
