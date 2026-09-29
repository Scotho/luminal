// Camera module barrel — kept ONLY to satisfy vi.mock('../camera/index') in tests.
// Production code imports directly from the concrete source files.

// ts-prune-ignore-next
export { createCameraState, seedCameraState, updateCamera, resetCamera } from './cameraRig';
// ts-prune-ignore-next
export { setCameraFOV, setCameraDist, setCameraLookAhead, setCameraLerp, setShakeEnabled, getCameraParams } from './cameraConfig';
