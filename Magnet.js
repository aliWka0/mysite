// Magnet - Vanilla JS Version (converted from React)
// Magnetic hover effect for elements - fixed for card-nav

(function () {
    class Magnet {
        constructor(element, options = {}) {
            this.element = element;
            this.options = {
                padding: options.padding || 100,
                disabled: options.disabled || false,
                magnetStrength: options.magnetStrength || 2,
                activeTransition: options.activeTransition || 'transform 0.3s ease-out',
                inactiveTransition: options.inactiveTransition || 'transform 0.5s ease-in-out'
            };

            this.isActive = false;
            this.position = { x: 0, y: 0 };

            this.init();
        }

        init() {
            // Don't wrap - just apply transform directly to element
            this.element.classList.add('magnet-element');
            this.element.style.transition = this.options.inactiveTransition;
            this.element.style.willChange = 'transform';

            // Add mouse move listener
            this.handleMouseMove = this.handleMouseMove.bind(this);
            window.addEventListener('mousemove', this.handleMouseMove);
        }

        handleMouseMove(e) {
            if (this.options.disabled) {
                this.setPosition(0, 0);
                return;
            }

            const rect = this.element.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            const distX = Math.abs(centerX - e.clientX);
            const distY = Math.abs(centerY - e.clientY);

            if (distX < rect.width / 2 + this.options.padding &&
                distY < rect.height / 2 + this.options.padding) {

                this.isActive = true;
                this.element.style.transition = this.options.activeTransition;

                const offsetX = (e.clientX - centerX) / this.options.magnetStrength;
                const offsetY = (e.clientY - centerY) / this.options.magnetStrength;
                this.setPosition(offsetX, offsetY);
            } else {
                if (this.isActive) {
                    this.isActive = false;
                    this.element.style.transition = this.options.inactiveTransition;
                    this.setPosition(0, 0);
                }
            }
        }

        setPosition(x, y) {
            this.position = { x, y };
            this.element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        }

        destroy() {
            window.removeEventListener('mousemove', this.handleMouseMove);
        }
    }

    // Auto-initialize on elements with data-magnet attribute
    function initMagnets() {
        const elements = document.querySelectorAll('[data-magnet]');
        elements.forEach(el => {
            if (el._magnet) return; // Already initialized

            const options = {
                padding: parseInt(el.dataset.magnetPadding) || 80,
                magnetStrength: parseInt(el.dataset.magnetStrength) || 4,
                disabled: el.dataset.magnetDisabled === 'true'
            };

            el._magnet = new Magnet(el, options);
        });
    }

    // Expose globally
    window.Magnet = Magnet;
    window.initMagnets = initMagnets;

    // Auto-initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMagnets);
    } else {
        initMagnets();
    }
})();
