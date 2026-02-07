// DecryptedText - Vanilla JS Version (converted from React)
// Text reveal animation with scrambling effect

(function () {
    const DEFAULT_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()_+';

    class DecryptedText {
        constructor(element, options = {}) {
            this.element = element;
            this.originalText = element.textContent.trim();
            this.options = {
                speed: options.speed || 50,
                maxIterations: options.maxIterations || 10,
                sequential: options.sequential !== false,
                revealDirection: options.revealDirection || 'start',
                characters: options.characters || DEFAULT_CHARS,
                animateOn: options.animateOn || 'hover', // 'hover', 'view', 'both'
                encryptedClass: options.encryptedClass || 'encrypted-char',
                revealedClass: options.revealedClass || 'revealed-char'
            };

            this.isAnimating = false;
            this.hasAnimated = false;
            this.revealedIndices = new Set();
            this.interval = null;

            this.init();
        }

        init() {
            // Wrap each character in a span
            this.element.innerHTML = '';
            this.element.classList.add('decrypted-text');

            this.originalText.split('').forEach((char, index) => {
                const span = document.createElement('span');
                span.textContent = char;
                span.dataset.index = index;
                span.dataset.original = char;
                if (char !== ' ') {
                    span.classList.add(this.options.encryptedClass);
                }
                this.element.appendChild(span);
            });

            this.charSpans = Array.from(this.element.querySelectorAll('span'));

            // Setup event listeners based on animateOn option
            if (this.options.animateOn === 'hover' || this.options.animateOn === 'both') {
                this.element.addEventListener('mouseenter', () => this.startAnimation());
                this.element.addEventListener('mouseleave', () => this.resetText());
            }

            if (this.options.animateOn === 'view' || this.options.animateOn === 'both') {
                this.setupIntersectionObserver();
            }
        }

        setupIntersectionObserver() {
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting && !this.hasAnimated) {
                        this.startAnimation();
                        this.hasAnimated = true;
                    }
                });
            }, { threshold: 0.1 });

            observer.observe(this.element);
        }

        getNextIndex() {
            const textLength = this.originalText.length;
            switch (this.options.revealDirection) {
                case 'start':
                    return this.revealedIndices.size;
                case 'end':
                    return textLength - 1 - this.revealedIndices.size;
                case 'center': {
                    const middle = Math.floor(textLength / 2);
                    const offset = Math.floor(this.revealedIndices.size / 2);
                    const nextIndex = this.revealedIndices.size % 2 === 0
                        ? middle + offset
                        : middle - offset - 1;
                    if (nextIndex >= 0 && nextIndex < textLength && !this.revealedIndices.has(nextIndex)) {
                        return nextIndex;
                    }
                    for (let i = 0; i < textLength; i++) {
                        if (!this.revealedIndices.has(i)) return i;
                    }
                    return 0;
                }
                default:
                    return this.revealedIndices.size;
            }
        }

        getRandomChar() {
            return this.options.characters.charAt(
                Math.floor(Math.random() * this.options.characters.length)
            );
        }

        scrambleText() {
            this.charSpans.forEach((span, index) => {
                const originalChar = span.dataset.original;
                if (originalChar === ' ') return;

                if (this.revealedIndices.has(index)) {
                    span.textContent = originalChar;
                    span.classList.remove(this.options.encryptedClass);
                    span.classList.add(this.options.revealedClass);
                } else {
                    span.textContent = this.getRandomChar();
                    span.classList.add(this.options.encryptedClass);
                    span.classList.remove(this.options.revealedClass);
                }
            });
        }

        startAnimation() {
            if (this.isAnimating) return;
            this.isAnimating = true;
            this.revealedIndices = new Set();
            let iteration = 0;

            this.interval = setInterval(() => {
                if (this.options.sequential) {
                    if (this.revealedIndices.size < this.originalText.length) {
                        const nextIndex = this.getNextIndex();
                        // Skip spaces
                        if (this.originalText[nextIndex] === ' ') {
                            this.revealedIndices.add(nextIndex);
                        } else {
                            this.revealedIndices.add(nextIndex);
                        }
                        this.scrambleText();
                    } else {
                        this.completeAnimation();
                    }
                } else {
                    this.scrambleText();
                    iteration++;
                    if (iteration >= this.options.maxIterations) {
                        this.completeAnimation();
                    }
                }
            }, this.options.speed);
        }

        completeAnimation() {
            clearInterval(this.interval);
            this.isAnimating = false;

            // Show original text
            this.charSpans.forEach((span, index) => {
                span.textContent = span.dataset.original;
                span.classList.remove(this.options.encryptedClass);
                span.classList.add(this.options.revealedClass);
            });
        }

        resetText() {
            if (this.options.animateOn === 'view') return; // Don't reset for view-only

            clearInterval(this.interval);
            this.isAnimating = false;
            this.revealedIndices = new Set();

            this.charSpans.forEach(span => {
                span.textContent = span.dataset.original;
                span.classList.remove(this.options.encryptedClass);
                span.classList.remove(this.options.revealedClass);
            });
        }
    }

    // Auto-initialize on elements with data-decrypt attribute
    function initDecryptedText() {
        const elements = document.querySelectorAll('[data-decrypt]');
        elements.forEach(el => {
            if (el._decryptedText) return;

            const options = {
                speed: parseInt(el.dataset.decryptSpeed) || 50,
                maxIterations: parseInt(el.dataset.decryptIterations) || 10,
                sequential: el.dataset.decryptSequential !== 'false',
                revealDirection: el.dataset.decryptDirection || 'start',
                animateOn: el.dataset.decryptOn || 'hover',
                characters: el.dataset.decryptChars || DEFAULT_CHARS
            };

            el._decryptedText = new DecryptedText(el, options);
        });
    }

    // Expose for programmatic use
    window.DecryptedText = DecryptedText;
    window.initDecryptedText = initDecryptedText;

    // Auto-initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initDecryptedText);
    } else {
        initDecryptedText();
    }
})();
