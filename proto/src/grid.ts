// Spatial hash grid (littensy's Grid, adapted to JS): the world is cut
// into square cells of `resolution` px; each item is stored in the cell
// containing it. Queries only scan the few cells overlapping the range
// instead of every item in the world -> cost follows LOCAL density,
// never the world total.

export interface GridItem {
    x: number;
    y: number;
}

export class SpatialGrid<T extends GridItem> {
    private cells = new Map<string, Set<T>>();
    private resolution: number;

    constructor(resolution: number) {
        this.resolution = resolution;
    }

    // Math.floor (not trunc): negative coordinates must get their own
    // cells (-0.5 must land in cell -1, not share cell 0)
    private cellKey(x: number, y: number): string {
        return `${Math.floor(x / this.resolution)},${Math.floor(y / this.resolution)}`;
    }

    // For per-frame rebuilds (moving items): empty everything, refill
    clear() {
        this.cells.clear();
    }

    insert(item: T) {
        const key = this.cellKey(item.x, item.y);
        let cell = this.cells.get(key);
        if (!cell) {
            cell = new Set();
            this.cells.set(key, cell);
        }
        cell.add(item);
    }

    // /!\ Looks the item up in the cell matching its CURRENT x/y.
    // To move an item: remove() FIRST, mutate x/y, then insert() again —
    // otherwise it stays filed in a stale cell and queries miss it.
    remove(item: T) {
        const key = this.cellKey(item.x, item.y);
        const cell = this.cells.get(key);
        if (!cell) return;
        cell.delete(item);
        if (cell.size === 0) this.cells.delete(key);
    }

    // BROAD phase: returns every item stored in cells overlapping the
    // square [x +/- range, y +/- range]. Some candidates sit farther than
    // `range` (corner of a cell): the caller does the exact distance
    // check (NARROW phase).
    queryNear(x: number, y: number, range: number): T[] {
        const out: T[] = [];
        const minCX = Math.floor((x - range) / this.resolution);
        const maxCX = Math.floor((x + range) / this.resolution);
        const minCY = Math.floor((y - range) / this.resolution);
        const maxCY = Math.floor((y + range) / this.resolution);
        for (let cx = minCX; cx <= maxCX; cx++) {
            for (let cy = minCY; cy <= maxCY; cy++) {
                const cell = this.cells.get(`${cx},${cy}`);
                if (cell) {
                    for (const item of cell) out.push(item);
                }
            }
        }
        return out;
    }
}
