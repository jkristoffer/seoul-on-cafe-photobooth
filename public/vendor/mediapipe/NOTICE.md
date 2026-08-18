# Vendored third-party assets

## @mediapipe/tasks-vision

- Version: see `VERSION` (npm `@mediapipe/tasks-vision`)
- License: Apache-2.0 — https://www.apache.org/licenses/LICENSE-2.0
- Source: http://mediapipe.dev

Only the SIMD WebAssembly variant is vendored. `FilesetResolver.forVisionTasks()`
probes for SIMD support and requests exactly one variant, so the `_nosimd_`
build is unnecessary on a kiosk running a current Chrome. If the booth ever has
to run somewhere without WASM SIMD, add `vision_wasm_nosimd_internal.{js,wasm}`
from the same package version.

## face_landmarker.task

- License: Apache-2.0
- Model card and terms: https://developers.google.com/mediapipe/solutions/vision/face_landmarker
- Source: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task

These files are committed rather than fetched at build time so that a deploy —
and the PWA precache that follows it — never depends on a third-party host.
