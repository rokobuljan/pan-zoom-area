/*
 * ZoomPan
 */

// Helper functions

const el = (sel, par) => (par || document).querySelector(sel);
const clamp = (val, min, max) => Math.min(Math.max(val, min), max);
const noop = () => { };
const pointsDistance = (x1, x2, y1, y2) => Math.hypot(x2 - x1, y2 - y1);

const dragHandler = (el, evFn = {}) => {
    const onUp = (evt) => {
        removeEventListener("pointermove", evFn.onMove);
        removeEventListener("pointerup", onUp);
        removeEventListener("pointercancel", onUp);
        evFn.onUp?.(evt);
    };
    el.addEventListener("pointerdown", (evt) => {
        evt.preventDefault();
        addEventListener("pointermove", evFn.onMove);
        addEventListener("pointerup", onUp);
        addEventListener("pointercancel", onUp);
        evFn.onDown?.(evt);
    });
};

class ZoomPan {

    constructor(selector, options = {}) {

        Object.assign(
            this,
            // Defaults
            {
                width: 800, // Canvas width
                height: 600, // Canvas height
                offsetX: 0, // Pan offset. 0 = From canvas center
                offsetY: 0,
                scale: 1,
                scaleOld: 1,
                scaleMax: 10,
                scaleMin: 0.05,
                scaleFactor: 0.2,
                scaleTransition: 250,
                padd: 40,
                panStep: 50,
                fitOnInit: true,
                canDrag: true,
                canPinch: true,
                isDrag: false,
                onPan: noop,
                onPanStart: noop,
                onPanEnd: noop,
                onScale: noop,
                onInit: noop,
            },
            // User overrides:
            options,
            // Overrides:
            {
                pinchDistance: 0, // Distance between two pointers
                elParent: typeof selector === "string" ? el(selector) : selector,
                elViewport: el(".zoompan-viewport", this.elParent),
                elCanvas: el(".zoompan-canvas", this.elParent),
                elTrackX: el(".zoompan-track-x", this.elParent),
                elThumbX: el(".zoompan-thumb-x", this.elParent),
                elTrackY: el(".zoompan-track-y", this.elParent),
                elThumbY: el(".zoompan-thumb-y", this.elParent),
                _isWheel: false,
            });

        this.elParent.classList.add("zoompan");

        // Apply width height to canvas...
        this.resize();

        // ...and fit to viewport, or use option's scale and pan
        if (this.fitOnInit) {
            this.fit();
        } else {
            this.scaleTo(this.scale);
            this.panTo(this.offsetX, this.offsetY);
        }

        // Pointers

        const pointers = {
            mouse: new Map(),
            touch: new Map(),
        };

        const pointersUpdate = (ev) => pointers[ev.pointerType].set(ev.pointerId, ev);
        const pointersDelete = (ev) => pointers[ev.pointerType].delete(ev.pointerId);

        const handlePointer = (ev) => {
            // Just keep in mind that this function can be called sequentially on  
            // multiple pointers-move. If you understand that, you're good to go.

            const pointersType = pointers[ev.pointerType];
            const pointsEvts = pointersType.values();
            const pointersTot = pointersType.size;
            const isPinch = pointersTot === 2;

            const pointer1 = pointsEvts.next().value;
            const pointer2 = pointsEvts.next().value;

            let movementX = 0;
            let movementY = 0;

            if (!isPinch) {
                movementX = pointer1.movementX;
                movementY = pointer1.movementY;
            }
            else if (this.canPinch && ev === pointer2) {
                movementX = (pointer1.movementX + pointer2.movementX) / 2;
                movementY = (pointer1.movementY + pointer2.movementY) / 2;
                const pointM = { // Get XY of pinch center point
                    x: pointer1.x + (pointer2.x - pointer1.x) * 0.5,
                    y: pointer1.y + (pointer2.y - pointer1.y) * 0.5,
                };

                const pinchDistanceNew = pointsDistance(pointer2.x, pointer1.x, pointer2.y, pointer1.y);
                const pinchDistanceOld = this.pinchDistance || pinchDistanceNew;
                const pinchDistanceDiff = pinchDistanceNew - pinchDistanceOld;
                this.pinchDistance = pinchDistanceNew;
                const delta = pinchDistanceDiff * 0.025;
                const newScale = this.calcScaleDelta(delta);
                const { originX, originY } = this.getPointerOrigin(pointM);

                this.scaleTo(newScale, originX, originY);
            }

            // PS: canDrag is default to true, but if one wants to use i.e: Ctrl key
            // in order to drag the area, set the default to false and than manually
            // change it to true on Ctrl key press.
            if (this.canDrag) {
                this.panTo(this.offsetX + movementX, this.offsetY + movementY);
            }
        };

        const onStart = (ev) => {
            ev.preventDefault();
            pointersUpdate(ev);

            this.isDrag = true;

            addEventListener("pointermove", onMove);
            addEventListener("pointerup", onEnd);
            addEventListener("pointercancel", onEnd);

            this.onPanStart(ev);
        };

        const onMove = (ev) => {
            pointersUpdate(ev);
            handlePointer(ev);
        };

        const onEnd = (ev) => {
            pointersDelete(ev);

            const pointersType = pointers[ev.pointerType];
            const pointersTot = pointersType.size;

            if (pointersTot < 2) {
                this.pinchDistance = 0;
            }

            if (pointersTot === 0) {
                this.isDrag = false;

                removeEventListener("pointermove", onMove);
                removeEventListener("pointerup", onEnd);
                removeEventListener("pointercancel", onEnd);
            }

            this.onPanEnd();
        };

        this.elViewport.addEventListener("pointerdown", onStart, { passive: false });

        // Horizontal scrollbar track drag:
        dragHandler(this.elTrackX, {
            onDown: () => this.onPanStart(),
            onUp: () => this.onPanEnd(),
            onMove: (ev) => {
                const area = this.getArea();
                this.panTo(this.offsetX - (area.width / this.elTrackX.offsetWidth) * ev.movementX, this.offsetY);
            }
        });

        // Vertical scrollbar track drag:
        dragHandler(this.elTrackY, {
            onDown: () => this.onPanStart(),
            onUp: () => this.onPanEnd(),
            onMove: (ev) => {
                const area = this.getArea();
                this.panTo(this.offsetX, this.offsetY - (area.height / this.elTrackY.offsetHeight) * ev.movementY);
            }
        });

        // Fix pan on browser resize
        addEventListener("resize", () => {
            this.panTo(this.offsetX, this.offsetY);
        });

        // Emit init is done: 
        this.onInit();
    }

    /**
     * Get pointer origin XY from pointer position
     * relative from canvas center
     * @param {PointerEvent|Object} ev Event with x,y pointer coordinates of Object {x,y}
     * @returns {Object} {originX, originY} offsets from canvas center
     */
    getPointerOrigin(ev) {
        // Get XY coordinates from canvas center:
        const vpt = this.getViewport();
        const cvs = this.getCanvas();
        const originX = ev.x - vpt.x - cvs.x - cvs.width / 2;
        const originY = ev.y - vpt.y - cvs.y - cvs.height / 2;
        return { originX, originY }
    }

    /**
     * Get -1 or +1 integer delta from mousewheel 
     * @param {PointerEvent|Object} ev Event with deltaY of Object with the same deltaY property
     */
    getWheelDelta(ev) {
        const delta = Math.sign(-ev.deltaY);
        return delta;
    }

    /**
     * Calculate the new scale value by a given delta.
     * The returned value is calmped my the defined min max options.
     * @param {number} delta positive or negative integer 
     * @returns {number} new scale value
     */
    calcScaleDelta(delta) {
        const scale = this.scale * Math.exp(delta * this.scaleFactor);
        const scaleNew = clamp(scale, this.scaleMin, this.scaleMax);
        return scaleNew;
    }

    /**
     * Apply new width and height to canvas
     * (Also, update the scrollbars)
     * @param {number} width 
     * @param {number} height 
     */
    resize(width, height) {
        this.width = width ?? this.width;
        this.height = height ?? this.height;
        this.elCanvas.style.width = `${this.width}px`;
        this.elCanvas.style.height = `${this.height}px`;
        this.updateScrollbars();
    }

    /**
     * Fit ("contain") canvas into viewport center.
     * Scale to fit original size (1.0) or less with "padd" spacing
     */
    fit() {
        const wRatio = this.elViewport.clientWidth / (this.elCanvas.clientWidth + this.padd * 2);
        const hRatio = this.elViewport.clientHeight / (this.elCanvas.clientHeight + this.padd * 2);
        const fitRatio = +Math.min(1, wRatio, hRatio).toFixed(1);
        this.scaleTo(fitRatio);
        this.panTo(0, 0);
    }

    /**
     * Get client size and position of viewport
     * @returns {object} {width,height,x,y} of the viewport Element
     */
    getViewport() {
        const { width, height, x, y } = this.elViewport.getBoundingClientRect();
        return { width, height, x, y };
    }

    /**
     * Get canvas size and position relative to viewport
     * @returns {object} {width,height,x,y} of the (scaled) canvas Element
     */
    getCanvas() {
        const vpt = this.getViewport();
        const width = this.width * this.scale;
        const height = this.height * this.scale;
        const x = (vpt.width - width) / 2 + this.offsetX;
        const y = (vpt.height - height) / 2 + this.offsetY;
        return { width, height, x, y };
    }

    /**
     * Get the immaginary area size
     * PS: that area is just used to calculate the scrollbars
     * and to prevent the canvas to fully exit the viewport
     * (min visibility px defined by `padd`).
     * @returns {object} {width,height} of the fictive area
     */
    getArea() {
        const vpt = this.getViewport();
        const cvs = this.getCanvas();
        const width = (vpt.width - this.padd) * 2 + cvs.width;
        const height = (vpt.height - this.padd) * 2 + cvs.height;
        return { width, height };
    }

    /**
     * Repaint scrollbars.
     * Use after the canvas changes position or scales.
     */
    updateScrollbars() {
        const vpt = this.getViewport();
        const cvs = this.getCanvas();
        const area = this.getArea();
        const thumbSizeX = vpt.width ** 2 / area.width;
        const thumbSizeY = vpt.height ** 2 / area.height;
        const thumbPosX = (vpt.width - cvs.x - this.padd) / vpt.width * thumbSizeX;
        const thumbPosY = (vpt.height - cvs.y - this.padd) / vpt.height * thumbSizeY;
        const widthPercent = thumbSizeX / vpt.width * 100;
        const leftPercent = thumbPosX / vpt.width * 100;
        const heightPercent = thumbSizeY / vpt.height * 100;
        const topPercent = thumbPosY / vpt.height * 100
        this.elThumbX.style.width = `${widthPercent}%`;
        this.elThumbX.style.left = `${leftPercent}%`;
        this.elThumbY.style.height = `${heightPercent}%`;
        this.elThumbY.style.top = `${topPercent}%`;
    }

    /**
     * Apply canvas new scale by a given delta value (i.e: +1, -1, +2, ...)
     * @param {number} delta 
     */
    scaleDelta(delta) {
        const scaleNew = this.calcScaleDelta(delta);
        this.scaleTo(scaleNew);
    }

    /**
     * Scale canvas element up
     * Alias for scaling by delta +1
     */
    scaleUp() {
        this.scaleDelta(1);
    }

    /**
     * Scale canvas element down
     * Alias for scaling by delta -1
     */
    scaleDown() {
        this.scaleDelta(-1);
    }

    /**
     * Apply a new scale at a given origin point relative from canvas center
     * Useful when zooming in/out at a specific "anchor" point.
     * @param {number} scaleNew 
     * @param {number} originX Scale to X point (relative to canvas center)
     * @param {number} originY Scale to Y point (relative to canvas center)
     */
    scaleTo(scaleNew = 1, originX, originY) {
        this.scaleOld = this.scale;
        this.scale = clamp(scaleNew, this.scaleMin, this.scaleMax);

        // The default XY origin is in the canvas center, 
        // If the origin changed (i.e: by mouse wheel at
        // coordinates-from-center) use the new scaling origin:
        if (originX !== undefined && originY !== undefined) {
            // Calculate the XY as if the element is in its
            // original, non-scaled size: 
            const xOrg = originX / this.scaleOld;
            const yOrg = originY / this.scaleOld;

            // Calculate the scaled XY 
            const xNew = xOrg * scaleNew;
            const yNew = yOrg * scaleNew;

            // Retrieve the XY difference to be used as the change in offset:
            const xDiff = originX - xNew;
            const yDiff = originY - yNew;

            this.panTo(this.offsetX + xDiff, this.offsetY + yDiff);
        } else {
            this.updateScrollbars();
        }

        this.elCanvas.style.scale = this.scale;

        // Animate canvas on mousewheel scale
        if (this._isWheel && this.scaleTransition > 0 ) {
            this.elCanvas.style.transition = `scale ${this.scaleTransition}ms, translate ${this.scaleTransition}ms`;
            this.elCanvas.addEventListener("transitionend", () => {
                // Reset to 0 so further panning will not be affected
                this.elCanvas.style.transition = `scale 0ms, translate 0ms`;
                this.onScale();
            }, { once: true });
        } else {
            this.onScale();
        }

        this._isWheel = false;
    }

    /**
     * Apply scale from the mouse wheel Event at the given
     *  pointer origin relative to canvas center.
     * @param {WheelEvent} ev 
     */
    scaleWheel(ev) {
        ev.preventDefault();
        const delta = this.getWheelDelta(ev);
        const scaleNew = this.calcScaleDelta(delta);
        const { originX, originY } = this.getPointerOrigin(ev);
        this._isWheel = true;
        this.scaleTo(scaleNew, originX, originY);
    }

    /**
     * Pan the canvas element to the new XY offset values
     * PS: offsets are relative to the canvas center.
     * @param {number} offsetX 
     * @param {number} offsetY 
     */
    panTo(offsetX, offsetY) {
        const vpt = this.getViewport();
        const width = this.width * this.scale;
        const height = this.height * this.scale;
        // Clamp offsets to prevent canvas exit viewport
        // (and scrollbars thumbs move out of track):
        const spaceX = vpt.width / 2 + width / 2 - this.padd;
        const spaceY = vpt.height / 2 + height / 2 - this.padd;
        this.offsetX = clamp(offsetX, -spaceX, spaceX);
        this.offsetY = clamp(offsetY, -spaceY, spaceY);
        this.updateScrollbars();

        this.elCanvas.style.translate = `${this.offsetX}px ${this.offsetY}px`;
        this.onPan();
    }

    /**
     * Pan the canvas up by panStep px.
     */
    panUp() {
        this.panTo(this.offsetX, this.offsetY - this.panStep);
    }

    /**
     * Pan the canvas down by panStep px.
     */
    panDown() {
        this.panTo(this.offsetX, this.offsetY + this.panStep);
    }

    /**
     * Pan the canvas left by panStep px.
     */
    panLeft() {
        this.panTo(this.offsetX - this.panStep, this.offsetY);
    }

    /**
     * Pan the canvas right by panStep px.
     */
    panRight() {
        this.panTo(this.offsetX + this.panStep, this.offsetY);
    }
}

export default ZoomPan
