/**
 * Whether the pointer actually travelled during the current gesture.
 *
 * Orbiting starts on empty space, and R3F treats any pointer-up with no hit as
 * a click — which would clear the selection every time you swung the camera
 * round. This lets the miss handler tell a click from a drag.
 */
export const gesture = { moved: false }
