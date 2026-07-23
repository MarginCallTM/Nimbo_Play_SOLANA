// Input NEVER touches the snake: it only exposes an INTENT (desired
// angle); the simulation decides what to do with it. Same split as the
// future client->server flow in ARENA-1

let mouseX = 0;
let mouseY = 0;
let boosting = false;

export function initInput() {
    window.addEventListener("pointermove", (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
    });
    // boost intent: hold left mouse button (or spacebar, like slither.io)
    window.addEventListener("pointerdown", (e) => {
        if (e.button === 0) boosting = true;
    });
    window.addEventListener("pointerup", (e) => {
        if (e.button === 0) boosting = false;
    });
    window.addEventListener("keydown", (e) => {
        if (e.code === "Space") boosting = true;
    });
    window.addEventListener("keyup", (e) => {
        if (e.code === "Space") boosting = false;
    });
}

export function isBoosting(): boolean {
    return boosting;
}

// The camera keeps the head centered on screen, so the desired
// direction is simply the vector from screen center to the mouse
export function getDesiredAngle(screenW: number, screenH: number): number {
    return Math.atan2(mouseY - screenH / 2, mouseX - screenW / 2);
}