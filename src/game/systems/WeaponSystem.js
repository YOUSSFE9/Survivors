/**
 * WeaponSystem — Handles M4 (rapid fire) and Bazooka (AoE) weapons.
 */
export const WEAPONS = {
  M4: {
    name: 'M4',
    fireRate: 150,
    damage: 10,
    bulletSpeed: 600,
    bulletSize: 4,
    ammoPerClip: 30,
    maxAmmo: 120,
    color: 0xffaa00,
    spread: 0.05,
    isExplosive: false,
  },
  BAZOOKA: {
    name: 'Bazooka',
    fireRate: 1000,
    damage: 50,
    bulletSpeed: 350,
    bulletSize: 8,
    ammoPerClip: 3,
    maxAmmo: 15,
    color: 0xff3300,
    spread: 0,
    isExplosive: true,
    explosionRadius: 80,
  },
};

export class WeaponSystem {
  constructor(scene) {
    this.scene = scene;
    this.lastFireTime = {};
  }

  canFire(weaponKey) {
    const weapon = WEAPONS[weaponKey];
    const now = Date.now();
    const last = this.lastFireTime[weaponKey] || 0;
    return now - last >= weapon.fireRate;
  }

  fire(weaponKey, x, y, angle) {
    const weapon = WEAPONS[weaponKey];
    if (!this.canFire(weaponKey)) return null;

    this.lastFireTime[weaponKey] = Date.now();

    const spread = (Math.random() - 0.5) * weapon.spread;
    const fireAngle = angle + spread;

    const vx = Math.cos(fireAngle) * weapon.bulletSpeed;
    const vy = Math.sin(fireAngle) * weapon.bulletSpeed;

    // Use the GameScene's createBullet method
    const bullet = this.scene.createBullet(
      x, y, vx, vy,
      weapon.damage,
      weapon.isExplosive,
      weapon.explosionRadius || 0,
      weaponKey
    );

    return bullet;
  }
}
