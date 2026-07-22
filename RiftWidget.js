/**
 * ============================================================
 * RiftWidget.js - Interactive Female Anime Character Dimensional Rift
 * ============================================================
 */

class RiftWidget {
    constructor() {
        this.isOpen = false;
        this.particles = [];
        this.animId = null;
        this.characterImg = new Image();
        this.characterImg.src = '/assets/images/female_cyber_anime_rift.png';
        this.imgLoaded = false;
        this.characterImg.onload = () => { this.imgLoaded = true; };
        this.init();
    }

    init() {
        // Create trigger button
        this.createButton();

        // Create container & canvas
        this.createViewport();

        // Bind events
        this.bindEvents();
    }

    createButton() {
        const btn = document.createElement('button');
        btn.className = 'rift-trigger-btn cursor-target';
        btn.id = 'rift-trigger-btn';
        btn.setAttribute('title', 'Boyut Yarığı (Dimensional Rift)');
        btn.innerHTML = `
            <svg class="rift-btn-icon" viewBox="0 0 24 24">
                <path d="M12 2L15 9L22 12L15 15L12 22L9 15L2 12L9 9L12 2Z" fill="none" stroke="#00d2ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <circle cx="12" cy="12" r="3" fill="#00d2ff"/>
            </svg>
        `;
        document.body.appendChild(btn);
        this.btn = btn;
    }

    createViewport() {
        const container = document.createElement('div');
        container.className = 'rift-viewport-container';
        container.id = 'rift-viewport-container';

        // Canvas for high performance 60FPS energy slash particles & anime visual
        const canvas = document.createElement('canvas');
        canvas.className = 'rift-canvas-render';
        container.appendChild(canvas);

        const border = document.createElement('div');
        border.className = 'rift-energy-border';
        container.appendChild(border);

        document.body.appendChild(container);

        this.container = container;
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        if (!this.canvas) return;
        const rect = this.container.getBoundingClientRect();
        this.width = this.canvas.width = rect.width * (window.devicePixelRatio || 1);
        this.height = this.canvas.height = rect.height * (window.devicePixelRatio || 1);
    }

    bindEvents() {
        if (this.btn) {
            this.btn.addEventListener('click', () => this.toggle());
        }
    }

    toggle() {
        this.isOpen = !this.isOpen;

        if (this.isOpen) {
            this.container.classList.add('active');
            this.spawnElectricParticles();
            this.startAnimation();
        } else {
            this.container.classList.remove('active');
            if (this.animId) cancelAnimationFrame(this.animId);
        }
    }

    spawnElectricParticles() {
        this.particles = [];
        const count = 50;
        for (let i = 0; i < count; i++) {
            this.particles.push({
                x: this.width * 0.7,
                y: this.height * 0.7,
                vx: (Math.random() - 0.7) * 10,
                vy: (Math.random() - 0.7) * 10,
                size: Math.random() * 4 + 2,
                alpha: 1,
                decay: Math.random() * 0.02 + 0.01,
                color: Math.random() > 0.3 ? '#00d2ff' : '#ffffff'
            });
        }
    }

    startAnimation() {
        let frame = 0;
        const render = () => {
            if (!this.isOpen) return;
            frame++;

            this.ctx.clearRect(0, 0, this.width, this.height);

            // Draw Anime Character Reaching Out / Portal Tear Visual
            this.drawAnimeCharacterRift(frame);

            // Draw Electric Slash Particles
            this.updateAndDrawParticles();

            this.animId = requestAnimationFrame(render);
        };
        render();
    }

    drawAnimeCharacterRift(frame) {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        ctx.save();

        const progress = Math.min(1, frame / 25);

        // Render Higgsfield Generated Female Anime Character Image
        if (this.imgLoaded) {
            ctx.globalAlpha = progress;
            // Draw image with electric blue glowing border/shadow
            ctx.shadowColor = '#00d2ff';
            ctx.shadowBlur = 20;

            // Rounded clip mask for organic portal opening effect
            ctx.beginPath();
            ctx.arc(w * 0.5, h * 0.5, (w * 0.48) * progress, 0, Math.PI * 2);
            ctx.clip();

            ctx.drawImage(this.characterImg, 0, 0, w, h);
        }

        // Glowing Blue Portal Tear Slash Overlay
        ctx.beginPath();
        const slashLength = h * 0.95 * progress;
        ctx.moveTo(w * 0.95, h * 0.05);
        ctx.lineTo(w * 0.95 - slashLength * 0.6, h * 0.05 + slashLength);
        ctx.strokeStyle = '#00d2ff';
        ctx.lineWidth = 8;
        ctx.shadowColor = '#00e1ff';
        ctx.shadowBlur = 30;
        ctx.stroke();

        ctx.restore();
    }

    updateAndDrawParticles() {
        const ctx = this.ctx;
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.alpha -= p.decay;

            if (p.alpha <= 0) {
                this.particles.splice(i, 1);
                continue;
            }

            ctx.save();
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }
}

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
    window.riftWidget = new RiftWidget();
});
