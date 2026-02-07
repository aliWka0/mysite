// LogoLoop - Simple CSS Animation Version
// Infinite scrolling logo/text banner using CSS keyframes

(function () {
    class LogoLoop {
        constructor(container, options = {}) {
            this.container = container;
            this.options = {
                items: options.items || [],
                speed: options.speed || 60,
                direction: options.direction || 'left',
                logoHeight: options.logoHeight || 28,
                gap: options.gap || 32,
                fadeOut: options.fadeOut !== false,
                scaleOnHover: options.scaleOnHover || false,
                fadeOutColor: options.fadeOutColor || '#000000'
            };

            this.init();
        }

        init() {
            // Set CSS variables
            this.container.style.setProperty('--logoloop-gap', `${this.options.gap}px`);
            this.container.style.setProperty('--logoloop-logoHeight', `${this.options.logoHeight}px`);
            if (this.options.fadeOutColor) {
                this.container.style.setProperty('--logoloop-fadeColor', this.options.fadeOutColor);
            }

            // Add classes
            this.container.classList.add('logoloop', 'logoloop--horizontal');
            if (this.options.fadeOut) this.container.classList.add('logoloop--fade');
            if (this.options.scaleOnHover) this.container.classList.add('logoloop--scale-hover');

            // Create track with CSS animation
            const track = document.createElement('div');
            track.className = 'logoloop__track';

            // Animation direction
            const animationName = this.options.direction === 'right' ? 'scrollRight' : 'scrollLeft';
            track.style.animation = `${animationName} ${this.options.speed}s linear infinite`;

            // Create two copies for seamless loop
            for (let copy = 0; copy < 2; copy++) {
                const list = document.createElement('ul');
                list.className = 'logoloop__list';
                list.setAttribute('role', 'list');
                if (copy > 0) list.setAttribute('aria-hidden', 'true');

                this.options.items.forEach((item) => {
                    const li = document.createElement('li');
                    li.className = 'logoloop__item';

                    if (item.href) {
                        const link = document.createElement('a');
                        link.className = 'logoloop__link cursor-target';
                        link.href = item.href;
                        link.target = '_blank';
                        link.rel = 'noreferrer noopener';
                        link.innerHTML = `<span class="logoloop__node">${item.text || ''}</span>`;
                        li.appendChild(link);
                    } else {
                        const span = document.createElement('span');
                        span.className = 'logoloop__node';
                        span.textContent = item.text || '';
                        li.appendChild(span);
                    }

                    list.appendChild(li);
                });

                track.appendChild(list);
            }

            this.container.appendChild(track);

            // Pause on hover
            track.addEventListener('mouseenter', () => {
                track.style.animationPlayState = 'paused';
            });
            track.addEventListener('mouseleave', () => {
                track.style.animationPlayState = 'running';
            });
        }
    }

    // Expose globally
    window.LogoLoop = LogoLoop;
})();
