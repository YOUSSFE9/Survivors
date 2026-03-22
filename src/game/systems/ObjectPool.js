/**
 * ObjectPool — Generic object pooling system for performance optimization.
 * Pre-allocates and recycles game objects (bullets, enemies, particles).
 */
export class ObjectPool {
    constructor(scene, createFn, initialSize = 20) {
        this.scene = scene;
        this.createFn = createFn;
        this.pool = [];
        this.active = [];

        for (let i = 0; i < initialSize; i++) {
            const obj = this.createFn(scene);
            obj.setActive(false).setVisible(false);
            this.pool.push(obj);
        }
    }

    get() {
        let obj = this.pool.pop();
        if (!obj) {
            obj = this.createFn(this.scene);
        }
        obj.setActive(true).setVisible(true);
        this.active.push(obj);
        return obj;
    }

    release(obj) {
        obj.setActive(false).setVisible(false);
        if (obj.body) {
            obj.body.reset(0, 0);
            obj.body.stop();
        }
        const idx = this.active.indexOf(obj);
        if (idx !== -1) this.active.splice(idx, 1);
        this.pool.push(obj);
    }

    releaseAll() {
        while (this.active.length > 0) {
            this.release(this.active[0]);
        }
    }

    getActiveObjects() {
        return this.active;
    }

    destroy() {
        this.pool.forEach(o => o.destroy && o.destroy());
        this.active.forEach(o => o.destroy && o.destroy());
        this.pool = [];
        this.active = [];
    }
}
