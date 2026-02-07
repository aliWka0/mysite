document.addEventListener('DOMContentLoaded', () => {

    // --- Hero Animation: Antigravity 3D Particle Cloud ---
    const canvas = document.querySelector('.stagger-visualizer');
    const ctx = canvas.getContext('2d');

    // 3D Configuration
    const particleCount = 800; // Increased density
    const focalLength = 400;
    const depth = 2000;

    let particles = [];
    let mouse = { x: 0, y: 0 };
    let targetMouse = { x: 0, y: 0 }; // For smooth easing
    let width, height;

    function resize() {
        // Set canvas to full screen/window size to ensure global coverage
        const wrapper = document.querySelector('.animation-wrapper');
        width = canvas.width = wrapper.offsetWidth; // Should match window width if fixed
        height = canvas.height = wrapper.offsetHeight;
        initParticles();
    }

    class Particle {
        constructor() {
            this.reset();
        }

        reset() {
            // Wider spread for full coverage even at corners (Fix for "insufficient")
            // Increased multiplier from 4 to 8 to cover aggressive parallax shifts
            this.x = (Math.random() - 0.5) * width * 8;
            this.y = (Math.random() - 0.5) * height * 8;
            this.z = Math.random() * depth;

            // Bigger and brighter
            this.size = Math.random() * 3 + 1.5;
            this.color = Math.random() > 0.5 ? '#ffffff' : '#888888'; // White and gray theme

            this.isShooter = Math.random() > 0.95; // More shooters
            this.velZ = this.isShooter ? Math.random() * 20 + 10 : 0; // Faster shooters
        }

        update() {
            // Constant forward movement for everyone (Infinite Flythrough)
            // Shooters retain their high speed, regular stars get a slow drift
            // This ensures background is never static even if mouse stops
            const speed = this.isShooter ? this.velZ : 2;
            this.z -= speed;

            // Reset when they pass the camera
            if (this.z <= 0) {
                this.reset();
                this.z = depth; // Respawn at far end for continuous stream
            }
        }

        draw(ctx) {
            // 1. Calculate Perspective
            // Simple camera tilt: shift x/y logic based on mouse
            // We shift the "world" opposite to mouse to simulate camera turn
            // Aggressive Camera Tilt (Increased multiplier 1.5 -> 5.0)
            const cameraX = (mouse.x - width / 2) * 5.0;
            const cameraY = (mouse.y - height / 2) * 5.0;

            // Apply parallax: Closer items (low z) shift more? 
            // In standard 3D: shift = camera * (factor)
            // Let's model rotation: x' = x * cos(angle) - z * sin(angle)
            // Simplified Parallax Shift:
            const shiftX = (cameraX * (depth - this.z)) / depth;
            const shiftY = (cameraY * (depth - this.z)) / depth;

            // Final 3D point relative to camera
            const x3d = this.x - shiftX;
            const y3d = this.y - shiftY;
            const z3d = this.z;

            // Clip if behind camera
            if (z3d <= -focalLength) return;

            // 2. Projection (3D -> 2D)
            const scale = focalLength / (focalLength + z3d);
            const x2d = x3d * scale + width / 2;
            const y2d = y3d * scale + height / 2;

            // Draw
            // Opacity based on depth (fog)
            const alpha = Math.min(1, scale * 2);
            ctx.globalAlpha = alpha;
            ctx.fillStyle = this.color;

            // Different drawing for shooters vs stars
            if (this.isShooter) {
                // Trail effect
                const trailScale = focalLength / (focalLength + z3d + 150);
                const tx = this.x * trailScale + width / 2; // Approximate trail origin
                ctx.beginPath();
                ctx.moveTo(x2d, y2d);
                // Longer dashes
                ctx.lineTo(x2d + (x2d - width / 2) * 0.2, y2d + (y2d - height / 2) * 0.2);
                ctx.strokeStyle = this.color;
                ctx.lineWidth = 3 * scale;
                ctx.stroke();
            } else {
                ctx.beginPath();
                ctx.arc(x2d, y2d, this.size * scale, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
        }
    }

    function initParticles() {
        particles = [];
        for (let i = 0; i < particleCount; i++) {
            particles.push(new Particle());
        }
    }

    function animate() {
        ctx.clearRect(0, 0, width, height);

        // Smooth Mouse Easing (Camera inertia)
        mouse.x += (targetMouse.x - mouse.x) * 0.05;
        mouse.y += (targetMouse.y - mouse.y) * 0.05;

        // Render particles sorted by depth (painter's algorithm - optional for dots but good for trails)
        // particles.sort((a, b) => b.z - a.z); // Optimization: skip sort if just additive blending dots

        particles.forEach(p => {
            p.update();
            p.draw(ctx);
        });
        requestAnimationFrame(animate);
    }

    // Init Logic
    window.addEventListener('resize', resize);
    resize();
    animate();

    // Global Mouse Interaction (Fix: Window instead of heroSection)
    window.addEventListener('mousemove', (e) => {
        // We want mouse coordinates relative to the window, not just the canvas if it was absolute
        // Since canvas is fixed 100vw/100vh, clientX/Y is perfect
        targetMouse.x = e.clientX;
        targetMouse.y = e.clientY;
    });

    // Reset camera on leave
    document.addEventListener('mouseleave', () => {
        targetMouse.x = width / 2;
        targetMouse.y = height / 2;
    });

    // --- Scroll Animations ---
    const scrollElements = document.querySelectorAll('.glass-card');
    anime.set(scrollElements, { opacity: 0, translateY: 50 });

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                anime({
                    targets: entry.target,
                    opacity: [0, 1],
                    translateY: [50, 0],
                    easing: 'easeOutExpo',
                    duration: 1000,
                    delay: 200 // Slight delay for smoothness
                });
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });

    scrollElements.forEach(el => observer.observe(el));

});
