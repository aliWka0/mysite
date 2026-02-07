
(function () {
    class Noise {
        constructor(options = {}) {
            this.patternSize = options.patternSize || 250;
            this.patternScaleX = options.patternScaleX || 1;
            this.patternScaleY = options.patternScaleY || 1;
            this.patternRefreshInterval = options.patternRefreshInterval || 2;
            this.patternAlpha = options.patternAlpha || 25; // Slight bump for visibility

            this.canvas = document.createElement('canvas');
            this.canvas.className = 'noise-overlay';
            this.ctx = this.canvas.getContext('2d');

            this.frame = 0;
            this.animationId = null;

            // Append to body or specific container
            const container = options.container || document.body;
            container.appendChild(this.canvas);

            this.resize = this.resize.bind(this);
            this.loop = this.loop.bind(this);

            window.addEventListener('resize', this.resize);
            this.resize();
            this.loop();
        }

        resize() {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
            this.canvas.style.width = '100vw';
            this.canvas.style.height = '100vh';
        }

        drawGrain() {
            const w = 512; // Fixed pattern size for performance, scaled by CSS
            const h = 512;

            // Re-use canvas dimensions if possible, but here we draw to full screen
            // actually user code drew to a small pattern canvas then scaled it maybe? 
            // The user code: canvas.width = canvasSize (1024). 
            // canvas.style.width = '100vw'.
            // Simple approach: Draw to window size.

            const canvasW = this.canvas.width;
            const canvasH = this.canvas.height;

            if (canvasW === 0 || canvasH === 0) return;

            const imageData = this.ctx.createImageData(canvasW, canvasH);
            const data = imageData.data;

            for (let i = 0; i < data.length; i += 4) {
                const value = Math.random() * 255;
                data[i] = value;
                data[i + 1] = value;
                data[i + 2] = value;
                data[i + 3] = this.patternAlpha;
            }

            this.ctx.putImageData(imageData, 0, 0);
        }

        loop() {
            if (this.frame % this.patternRefreshInterval === 0) {
                this.drawGrain();
            }
            this.frame++;
            this.animationId = window.requestAnimationFrame(this.loop);
        }

        destroy() {
            window.removeEventListener('resize', this.resize);
            window.cancelAnimationFrame(this.animationId);
            this.canvas.remove();
        }
    }

    window.Noise = Noise;
})();
