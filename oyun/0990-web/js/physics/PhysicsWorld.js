// ============================================
// PhysicsWorld — Cannon-es Physics Setup
// ============================================
import * as CANNON from 'cannon-es';
import { PHYSICS, TABLE } from '../constants.js';

export class PhysicsWorld {
    constructor() {
        this.world = new CANNON.World();
        // ❌ GRAVITY OFF — critical for billiards simulation
        this.world.gravity.set(0, PHYSICS.GRAVITY, 0); // GRAVITY = 0
        this.world.broadphase = new CANNON.SAPBroadphase(this.world);
        this.world.solver.iterations = PHYSICS.SOLVER_ITERATIONS;
        this.world.allowSleep = false;

        // Default contact material settings
        this.world.defaultContactMaterial.friction = 0.2;
        this.world.defaultContactMaterial.restitution = 0.3;

        // Materials
        this.ballMaterial = new CANNON.Material('ball');
        this.tableMaterial = new CANNON.Material('table');
        this.cushionMaterial = new CANNON.Material('cushion');

        // Contact materials — tuned to match Unity spec
        // Ball ↔ Ball: friction=0.2, bounciness=0.4
        const ballBall = new CANNON.ContactMaterial(this.ballMaterial, this.ballMaterial, {
            friction: 0.2,
            restitution: 0.4,
            contactEquationStiffness: 1e8,
            contactEquationRelaxation: 3,
        });

        // Ball ↔ Table surface: friction=0.3, bounciness=0.2
        const ballTable = new CANNON.ContactMaterial(this.ballMaterial, this.tableMaterial, {
            friction: PHYSICS.TABLE_FRICTION,
            restitution: PHYSICS.TABLE_RESTITUTION,
        });

        // Ball ↔ Cushion: friction=0.2, bounciness=0.6
        const ballCushion = new CANNON.ContactMaterial(this.ballMaterial, this.cushionMaterial, {
            friction: PHYSICS.CUSHION_FRICTION,
            restitution: PHYSICS.CUSHION_RESTITUTION,
            contactEquationStiffness: 1e8,
            contactEquationRelaxation: 3,
        });

        this.world.addContactMaterial(ballBall);
        this.world.addContactMaterial(ballTable);
        this.world.addContactMaterial(ballCushion);

        // Faz 13 mini-olay ("zıpzıp bantlar"): bant sekme katsayısını runtime'da
        // ölçekleyebilmek için temas materyalini sakla. clampToSurface'in dünya
        // sınırı güvenlik clamp'i topların masadan kaçmasını yine engeller.
        this._ballCushion = ballCushion;

        // Create the table surface body (keeps balls from going below surface)
        this._createTableSurface();
    }

    _createTableSurface() {
        const surfaceShape = new CANNON.Box(new CANNON.Vec3(
            TABLE.LENGTH / 2 + 0.3,
            0.1,
            TABLE.WIDTH / 2 + 0.3
        ));
        const surfaceBody = new CANNON.Body({
            mass: 0,
            material: this.tableMaterial,
            shape: surfaceShape,
            position: new CANNON.Vec3(0, TABLE.HEIGHT - 0.1, 0),
        });
        this.world.addBody(surfaceBody);
        this.tableBody = surfaceBody;
    }

    /** Add cushion bodies to physics world from table cushion data */
    addCushions(cushionDataArray) {
        cushionDataArray.forEach(cd => {
            const shape = new CANNON.Box(new CANNON.Vec3(
                cd.halfExtents.x,
                cd.halfExtents.y,
                cd.halfExtents.z
            ));
            const body = new CANNON.Body({
                mass: 0,
                material: this.cushionMaterial,
                shape,
                position: new CANNON.Vec3(cd.position.x, cd.position.y, cd.position.z),
            });
            this.world.addBody(body);
        });
    }

    /** Step the physics simulation */
    step(dt) {
        this.world.step(PHYSICS.TIMESTEP, dt, PHYSICS.MAX_SUB_STEPS);
    }

    /**
     * Faz 13 mini-olay: top↔bant sekme katsayısını ölçekle (>1 = daha çok sek,
     * "zıpzıp bantlar"). 1 = normal (PHYSICS.CUSHION_RESTITUTION).
     */
    setCushionRestitutionMul(mul) {
        if (this._ballCushion) this._ballCushion.restitution = PHYSICS.CUSHION_RESTITUTION * (mul > 0 ? mul : 1);
    }

    /** Add a body to the world */
    addBody(body) {
        this.world.addBody(body);
    }

    /** Remove a body from the world */
    removeBody(body) {
        this.world.removeBody(body);
    }

    /** Dispose */
    dispose() {
        // Clear all bodies
        while (this.world.bodies.length > 0) {
            this.world.removeBody(this.world.bodies[0]);
        }
    }
}
