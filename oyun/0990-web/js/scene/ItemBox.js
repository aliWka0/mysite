// ============================================
// ItemBox — Masada doğan tek eşya kutusu (Faz 2)
// ============================================
// Görsel: havada süzülen, dönen + zıplayan parlak küp ("?" kutusu hissi). Durum:
//   • active=true  → görünür + toplanabilir
//   • active=false → toplandı, RESPAWN sonra yeniden doğar
// Görünürlük = `_shown` (vsbot modunda açık) && active. Mantığı ItemBoxManager sürer.
import * as THREE from 'three';
import { TABLE, ITEMBOX } from '../constants.js';

export class ItemBox {
    constructor(scene, x, z) {
        this.scene = scene;
        this.x = x;
        this.z = z;
        this.active = true;
        this.respawn = 0;
        this._shown = false;            // vsbot dışında gizli
        this._t = Math.random() * Math.PI * 2;   // zıplama/dönme faz kayması

        const s = ITEMBOX.SIZE;
        const group = new THREE.Group();

        // Dolgu küp — yarı saydam camgöbeği, hafif emissive (unlit görünür).
        const cube = new THREE.Mesh(
            new THREE.BoxGeometry(s, s, s),
            new THREE.MeshBasicMaterial({ color: ITEMBOX.COLOR, transparent: true, opacity: 0.55 })
        );
        group.add(cube);

        // Kenar çizgileri — kutuya "?" blok hissi veren parlak hat.
        const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(s, s, s)),
            new THREE.LineBasicMaterial({ color: 0xffffff })
        );
        group.add(edges);

        group.position.set(x, TABLE.HEIGHT + ITEMBOX.HEIGHT, z);
        group.visible = false;
        this.mesh = group;
        this.scene.add(group);
        this._baseY = TABLE.HEIGHT + ITEMBOX.HEIGHT;
    }

    /** vsbot açık/kapalı (genel görünürlük kapısı). */
    setShown(shown) {
        this._shown = shown;
        this.mesh.visible = shown && this.active;
    }

    /** Toplandı → gizle + respawn sayacı başlat. */
    collect() {
        this.active = false;
        this.respawn = ITEMBOX.RESPAWN;
        this.mesh.visible = false;
    }

    /** Anında aktifleştir (maç/restart). */
    activate() {
        this.active = true;
        this.respawn = 0;
        this.mesh.visible = this._shown;
    }

    update(dt) {
        if (!this.active) {
            this.respawn -= dt;
            if (this.respawn <= 0) this.activate();
            return;
        }
        if (!this._shown) return;
        // Dön + hafif zıpla (canlı his).
        this._t += dt;
        this.mesh.rotation.y += dt * 1.8;
        this.mesh.rotation.x = Math.sin(this._t * 1.5) * 0.15;
        this.mesh.position.y = this._baseY + Math.sin(this._t * 2.2) * 0.006;
    }

    dispose() {
        this.scene.remove(this.mesh);
        this.mesh.traverse((o) => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) o.material.dispose();
        });
    }
}
