// TargetCursor - Vanilla JS Version (converted from React)
(function () {
    // Configuration
    const config = {
        targetSelector: '.cursor-target',
        spinDuration: 1,
        hideDefaultCursor: true,
        hoverDuration: 0.8,
        parallaxOn: true
    };

    const constants = {
        borderWidth: 3,
        cornerSize: 12
    };

    // Check for mobile
    function isMobile() {
        const hasTouchScreen = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        const isSmallScreen = window.innerWidth <= 768;
        const userAgent = navigator.userAgent || navigator.vendor || window.opera;
        const mobileRegex = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i;
        const isMobileUserAgent = mobileRegex.test(userAgent.toLowerCase());
        return (hasTouchScreen && isSmallScreen) || isMobileUserAgent;
    }

    if (isMobile()) return;

    // Create cursor HTML
    const cursorHTML = `
        <div class="target-cursor-wrapper">
            <div class="target-cursor-dot"></div>
            <div class="target-cursor-corner corner-tl"></div>
            <div class="target-cursor-corner corner-tr"></div>
            <div class="target-cursor-corner corner-br"></div>
            <div class="target-cursor-corner corner-bl"></div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', cursorHTML);

    const cursor = document.querySelector('.target-cursor-wrapper');
    const corners = cursor.querySelectorAll('.target-cursor-corner');
    const dot = cursor.querySelector('.target-cursor-dot');

    let spinTl = null;
    let isActive = false;
    let targetCornerPositions = null;
    let activeStrength = { current: 0 };
    let activeTarget = null;
    let currentLeaveHandler = null;
    let resumeTimeout = null;

    // Store original cursor
    const originalCursor = document.body.style.cursor;
    if (config.hideDefaultCursor) {
        document.body.style.cursor = 'none';
    }

    // Initial setup
    gsap.set(cursor, {
        xPercent: -50,
        yPercent: -50,
        x: window.innerWidth / 2,
        y: window.innerHeight / 2
    });

    // Create spin timeline
    function createSpinTimeline() {
        if (spinTl) spinTl.kill();
        spinTl = gsap.timeline({ repeat: -1 })
            .to(cursor, { rotation: '+=360', duration: config.spinDuration, ease: 'none' });
    }
    createSpinTimeline();

    // Move cursor
    function moveCursor(x, y) {
        gsap.to(cursor, {
            x,
            y,
            duration: 0.1,
            ease: 'power3.out'
        });
    }

    // Ticker function for parallax
    function tickerFn() {
        if (!targetCornerPositions || !cursor || !corners) return;

        const strength = activeStrength.current;
        if (strength === 0) return;

        const cursorX = gsap.getProperty(cursor, 'x');
        const cursorY = gsap.getProperty(cursor, 'y');

        corners.forEach((corner, i) => {
            const currentX = gsap.getProperty(corner, 'x');
            const currentY = gsap.getProperty(corner, 'y');

            const targetX = targetCornerPositions[i].x - cursorX;
            const targetY = targetCornerPositions[i].y - cursorY;

            const finalX = currentX + (targetX - currentX) * strength;
            const finalY = currentY + (targetY - currentY) * strength;

            const duration = strength >= 0.99 ? (config.parallaxOn ? 0.2 : 0) : 0.05;

            gsap.to(corner, {
                x: finalX,
                y: finalY,
                duration: duration,
                ease: duration === 0 ? 'none' : 'power1.out',
                overwrite: 'auto'
            });
        });
    }

    // Cleanup target
    function cleanupTarget(target) {
        if (currentLeaveHandler) {
            target.removeEventListener('mouseleave', currentLeaveHandler);
        }
        currentLeaveHandler = null;
    }

    // Mouse move handler
    window.addEventListener('mousemove', (e) => moveCursor(e.clientX, e.clientY));

    // Scroll handler
    window.addEventListener('scroll', () => {
        if (!activeTarget || !cursor) return;
        const mouseX = gsap.getProperty(cursor, 'x');
        const mouseY = gsap.getProperty(cursor, 'y');
        const elementUnderMouse = document.elementFromPoint(mouseX, mouseY);
        const isStillOverTarget =
            elementUnderMouse &&
            (elementUnderMouse === activeTarget || elementUnderMouse.closest(config.targetSelector) === activeTarget);
        if (!isStillOverTarget && currentLeaveHandler) {
            currentLeaveHandler();
        }
    }, { passive: true });

    // Mouse down/up handlers
    window.addEventListener('mousedown', () => {
        gsap.to(dot, { scale: 0.7, duration: 0.3 });
        gsap.to(cursor, { scale: 0.9, duration: 0.2 });
    });

    window.addEventListener('mouseup', () => {
        gsap.to(dot, { scale: 1, duration: 0.3 });
        gsap.to(cursor, { scale: 1, duration: 0.2 });
    });

    // Enter handler
    window.addEventListener('mouseover', (e) => {
        const directTarget = e.target;
        const allTargets = [];
        let current = directTarget;
        while (current && current !== document.body) {
            if (current.matches && current.matches(config.targetSelector)) {
                allTargets.push(current);
            }
            current = current.parentElement;
        }
        const target = allTargets[0] || null;
        if (!target || !cursor || !corners) return;
        if (activeTarget === target) return;
        if (activeTarget) {
            cleanupTarget(activeTarget);
        }
        if (resumeTimeout) {
            clearTimeout(resumeTimeout);
            resumeTimeout = null;
        }

        activeTarget = target;
        corners.forEach(corner => gsap.killTweensOf(corner));

        gsap.killTweensOf(cursor, 'rotation');
        if (spinTl) spinTl.pause();
        gsap.set(cursor, { rotation: 0 });

        const rect = target.getBoundingClientRect();
        const { borderWidth, cornerSize } = constants;
        const cursorX = gsap.getProperty(cursor, 'x');
        const cursorY = gsap.getProperty(cursor, 'y');

        targetCornerPositions = [
            { x: rect.left - borderWidth, y: rect.top - borderWidth },
            { x: rect.right + borderWidth - cornerSize, y: rect.top - borderWidth },
            { x: rect.right + borderWidth - cornerSize, y: rect.bottom + borderWidth - cornerSize },
            { x: rect.left - borderWidth, y: rect.bottom + borderWidth - cornerSize }
        ];

        isActive = true;
        gsap.ticker.add(tickerFn);

        gsap.to(activeStrength, {
            current: 1,
            duration: config.hoverDuration,
            ease: 'power2.out'
        });

        corners.forEach((corner, i) => {
            gsap.to(corner, {
                x: targetCornerPositions[i].x - cursorX,
                y: targetCornerPositions[i].y - cursorY,
                duration: 0.2,
                ease: 'power2.out'
            });
        });

        const leaveHandler = () => {
            gsap.ticker.remove(tickerFn);

            isActive = false;
            targetCornerPositions = null;
            gsap.set(activeStrength, { current: 0, overwrite: true });
            activeTarget = null;

            if (corners) {
                gsap.killTweensOf(corners);
                const { cornerSize } = constants;
                const positions = [
                    { x: -cornerSize * 1.5, y: -cornerSize * 1.5 },
                    { x: cornerSize * 0.5, y: -cornerSize * 1.5 },
                    { x: cornerSize * 0.5, y: cornerSize * 0.5 },
                    { x: -cornerSize * 1.5, y: cornerSize * 0.5 }
                ];
                const tl = gsap.timeline();
                corners.forEach((corner, index) => {
                    tl.to(corner, {
                        x: positions[index].x,
                        y: positions[index].y,
                        duration: 0.3,
                        ease: 'power3.out'
                    }, 0);
                });
            }

            resumeTimeout = setTimeout(() => {
                if (!activeTarget && cursor && spinTl) {
                    const currentRotation = gsap.getProperty(cursor, 'rotation');
                    const normalizedRotation = currentRotation % 360;
                    spinTl.kill();
                    spinTl = gsap.timeline({ repeat: -1 })
                        .to(cursor, { rotation: '+=360', duration: config.spinDuration, ease: 'none' });
                    gsap.to(cursor, {
                        rotation: normalizedRotation + 360,
                        duration: config.spinDuration * (1 - normalizedRotation / 360),
                        ease: 'none',
                        onComplete: () => {
                            if (spinTl) spinTl.restart();
                        }
                    });
                }
                resumeTimeout = null;
            }, 50);

            cleanupTarget(target);
        };

        currentLeaveHandler = leaveHandler;
        target.addEventListener('mouseleave', leaveHandler);
    }, { passive: true });

})();
