// ============================================
// InputManager — Mouse + Touch Input Handling
// ============================================

export class InputManager {
    constructor(domElement) {
        this.domElement = domElement;

        // State
        this.pointerDown = false;
        this.pointerPos = { x: 0, y: 0 };
        this.pointerDelta = { x: 0, y: 0 };
        this._prevPointerPos = { x: 0, y: 0 };

        // Accumulated deltas (consumed per frame)
        this._deltaX = 0;
        this._deltaY = 0;
        this._scrollDelta = 0;

        // Callbacks
        this._onPointerDownCallbacks = [];
        this._onPointerUpCallbacks = [];

        // Right click tracking
        this.rightDown = false;

        // Touch tracking (canvas = look + pinch-zoom area only).
        // The virtual joystick and shoot button live on separate DOM elements
        // and capture their own touches, so they never reach the canvas here.
        this._canvasTouches = new Map();  // identifier → {x, y}
        this._lookTouchId = null;          // the finger driving the look camera
        this._lookPrev = { x: 0, y: 0 };
        this._lastPinchDist = null;

        // Keyboard state
        this.keys = { w: false, a: false, s: false, d: false };

        // Bind handlers
        this._onMouseDown = this._handleMouseDown.bind(this);
        this._onMouseMove = this._handleMouseMove.bind(this);
        this._onMouseUp = this._handleMouseUp.bind(this);
        this._onWheel = this._handleWheel.bind(this);
        this._onTouchStart = this._handleTouchStart.bind(this);
        this._onTouchMove = this._handleTouchMove.bind(this);
        this._onTouchEnd = this._handleTouchEnd.bind(this);
        this._onKeyDown = this._handleKeyDown.bind(this);
        this._onKeyUp = this._handleKeyUp.bind(this);
        this._onContextMenu = (e) => e.preventDefault();

        // Attach
        domElement.addEventListener('mousedown', this._onMouseDown);
        domElement.addEventListener('mousemove', this._onMouseMove);
        window.addEventListener('mouseup', this._onMouseUp);
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
        domElement.addEventListener('wheel', this._onWheel, { passive: false });
        domElement.addEventListener('touchstart', this._onTouchStart, { passive: false });
        domElement.addEventListener('touchmove', this._onTouchMove, { passive: false });
        domElement.addEventListener('touchend', this._onTouchEnd);
        domElement.addEventListener('touchcancel', this._onTouchEnd);
        domElement.addEventListener('contextmenu', this._onContextMenu);
    }

    // ---- Keyboard Handlers ----
    _handleKeyDown(e) {
        const key = e.key.toLowerCase();
        if (this.keys.hasOwnProperty(key)) {
            this.keys[key] = true;
        }
    }

    _handleKeyUp(e) {
        const key = e.key.toLowerCase();
        if (this.keys.hasOwnProperty(key)) {
            this.keys[key] = false;
        }
    }

    // ---- Pointer Lock ----
    lockPointer() {
        this.domElement.requestPointerLock();
    }

    unlockPointer() {
        document.exitPointerLock();
    }

    isPointerLocked() {
        return document.pointerLockElement === this.domElement;
    }

    // ---- Mouse Handlers ----

    _handleMouseDown(e) {
        if (e.button === 0) {
            this.pointerDown = true;
            this._prevPointerPos.x = e.clientX;
            this._prevPointerPos.y = e.clientY;
            this.pointerPos.x = e.clientX;
            this.pointerPos.y = e.clientY;
            this._onPointerDownCallbacks.forEach(cb => cb(e.clientX, e.clientY));
        } else if (e.button === 2) {
            this.rightDown = true;
            this._prevPointerPos.x = e.clientX;
            this._prevPointerPos.y = e.clientY;
        }
    }

    _handleMouseMove(e) {
        this.pointerPos.x = e.clientX;
        this.pointerPos.y = e.clientY;

        if (this.isPointerLocked()) {
            // Pointer locked: use movementX/Y directly for TPS camera
            this._deltaX += e.movementX;
            this._deltaY += e.movementY;
        } else if (this.pointerDown || this.rightDown) {
            // Standard drag
            this._deltaX += e.clientX - this._prevPointerPos.x;
            this._deltaY += e.clientY - this._prevPointerPos.y;
        }

        this._prevPointerPos.x = e.clientX;
        this._prevPointerPos.y = e.clientY;
    }

    _handleMouseUp(e) {
        if (e.button === 0) {
            this.pointerDown = false;
            this._onPointerUpCallbacks.forEach(cb => cb());
        } else if (e.button === 2) {
            this.rightDown = false;
        }
    }

    _handleWheel(e) {
        e.preventDefault();
        this._scrollDelta += e.deltaY;
    }

    // ---- Touch Handlers ----
    // Only touches that START on the canvas reach these listeners (touch events
    // are dispatched to their touchstart target for the whole gesture). So the
    // joystick/shoot-button fingers are excluded automatically. We track canvas
    // touches by identifier and never read the global `e.touches` list.

    _handleTouchStart(e) {
        e.preventDefault();
        for (const touch of e.changedTouches) {
            this._canvasTouches.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
        }

        // First canvas finger drives the look camera and acts as the tap pointer
        // (used for ball-in-hand placement).
        if (this._lookTouchId === null && e.changedTouches.length > 0) {
            const t = e.changedTouches[0];
            this._lookTouchId = t.identifier;
            this._lookPrev.x = t.clientX;
            this._lookPrev.y = t.clientY;
            this.pointerPos.x = t.clientX;
            this.pointerPos.y = t.clientY;
            this.pointerDown = true;
            this._onPointerDownCallbacks.forEach(cb => cb(t.clientX, t.clientY));
        }

        if (this._canvasTouches.size >= 2) {
            this._lastPinchDist = this._computePinchDist();
        }
    }

    _handleTouchMove(e) {
        e.preventDefault();
        for (const touch of e.changedTouches) {
            if (this._canvasTouches.has(touch.identifier)) {
                this._canvasTouches.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
            }
        }

        // Two canvas fingers → pinch zoom (suppress look rotation while pinching).
        if (this._canvasTouches.size >= 2) {
            const dist = this._computePinchDist();
            if (this._lastPinchDist != null) {
                this._scrollDelta += (this._lastPinchDist - dist) * 2;
            }
            this._lastPinchDist = dist;
            return;
        }

        // Single finger → accumulate look-drag delta.
        for (const touch of e.changedTouches) {
            if (touch.identifier === this._lookTouchId) {
                this._deltaX += touch.clientX - this._lookPrev.x;
                this._deltaY += touch.clientY - this._lookPrev.y;
                this._lookPrev.x = touch.clientX;
                this._lookPrev.y = touch.clientY;
                this.pointerPos.x = touch.clientX;
                this.pointerPos.y = touch.clientY;
            }
        }
    }

    _handleTouchEnd(e) {
        for (const touch of e.changedTouches) {
            this._canvasTouches.delete(touch.identifier);
            if (touch.identifier === this._lookTouchId) {
                this._lookTouchId = null;
                this.pointerDown = false;
                this._onPointerUpCallbacks.forEach(cb => cb());
            }
        }

        if (this._canvasTouches.size < 2) {
            this._lastPinchDist = null;
        }

        // If the look finger lifted but another canvas finger is still down,
        // promote it so the camera keeps responding seamlessly.
        if (this._lookTouchId === null && this._canvasTouches.size > 0) {
            const [id, pos] = this._canvasTouches.entries().next().value;
            this._lookTouchId = id;
            this._lookPrev.x = pos.x;
            this._lookPrev.y = pos.y;
        }
    }

    _computePinchDist() {
        const pts = Array.from(this._canvasTouches.values());
        return Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    }

    // ---- API ----

    /** Consume accumulated deltas (call once per frame) */
    consumeDeltas() {
        const dx = this._deltaX;
        const dy = this._deltaY;
        const scroll = this._scrollDelta;
        this._deltaX = 0;
        this._deltaY = 0;
        this._scrollDelta = 0;
        return { dx, dy, scroll };
    }

    /** Register pointer down callback */
    onPointerDown(callback) {
        this._onPointerDownCallbacks.push(callback);
    }

    /** Register pointer up callback */
    onPointerUp(callback) {
        this._onPointerUpCallbacks.push(callback);
    }

    /** Get normalized pointer position (-1 to 1) */
    getNormalizedPointer() {
        return {
            x: (this.pointerPos.x / window.innerWidth) * 2 - 1,
            y: -(this.pointerPos.y / window.innerHeight) * 2 + 1,
        };
    }

    /** Destroy all listeners */
    destroy() {
        this.domElement.removeEventListener('mousedown', this._onMouseDown);
        this.domElement.removeEventListener('mousemove', this._onMouseMove);
        window.removeEventListener('mouseup', this._onMouseUp);
        this.domElement.removeEventListener('wheel', this._onWheel);
        this.domElement.removeEventListener('touchstart', this._onTouchStart);
        this.domElement.removeEventListener('touchmove', this._onTouchMove);
        this.domElement.removeEventListener('touchend', this._onTouchEnd);
        this.domElement.removeEventListener('touchcancel', this._onTouchEnd);
        this.domElement.removeEventListener('contextmenu', this._onContextMenu);
    }
}
