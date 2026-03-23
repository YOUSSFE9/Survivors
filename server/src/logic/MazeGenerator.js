/**
 * Deterministic seeded maze generator (CommonJS).
 * Same seed → identical maze on all clients and the server.
 * Produces 2-tile-wide corridors matching the offline look.
 */
function generate(w, h, scale, seed) {
    // Grid dimensions: each cell is `scale` tiles, plus 1 border tile
    // With scale=3: each cell=3 tiles → corridors are 2 tiles wide (like offline)
    const width  = w * scale + 1;
    const height = h * scale + 1;
    const tileSize = 32;
    const grid = Array.from({ length: height }, () => new Array(width).fill(1));

    // Simple seeded LCG RNG
    let s = seed >>> 0;
    const rng = () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 0xffffffff;
    };

    // Recursive backtracker (cell-based, each cell = scale tiles)
    const visited = Array.from({ length: h }, () => new Array(w).fill(false));

    function carveCell(cx, cy) {
        // Carve the cell interior (scale-1 x scale-1 floor tiles)
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

    // Collect floor tiles for spawn positions
    const floors = [];
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
            if (grid[y][x] === 0) floors.push({ x, y });

    // Shuffle floors with same rng
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
        playerSpawn, keyPositions, pickupPositions, enemyPositions, trapPositions,
    };
}

module.exports = { MazeGenerator: { generate } };
