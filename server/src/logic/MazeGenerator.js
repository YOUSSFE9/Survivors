/**
 * Deterministic seeded maze generator (CommonJS).
 * Same seed → identical maze on all clients and the server.
 */
function generate(w, h, scale, seed) {
    const width  = w * scale;
    const height = h * scale;
    const tileSize = 32;
    const grid = Array.from({ length: height }, () => new Array(width).fill(1));

    // Simple seeded LCG RNG
    let s = seed >>> 0;
    const rng = () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 0xffffffff;
    };

    const carved = new Set();
    const key = (x, y) => `${x}_${y}`;

    function carve(cx, cy) {
        grid[cy][cx] = 0;
        carved.add(key(cx, cy));
        const dirs = [[0,-2],[2,0],[0,2],[-2,0]].sort(() => rng() - 0.5);
        for (const [dx, dy] of dirs) {
            const nx = cx + dx, ny = cy + dy;
            if (nx > 0 && ny > 0 && nx < width-1 && ny < height-1 && !carved.has(key(nx,ny))) {
                grid[cy + dy/2][cx + dx/2] = 0;
                carve(nx, ny);
            }
        }
    }
    carve(1, 1);

    return { grid, width, height, tileSize, playerSpawn: { x: 1, y: 1 } };
}

module.exports = { MazeGenerator: { generate } };
