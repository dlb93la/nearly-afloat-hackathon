import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Group, Matrix4, OrthographicCamera, Vector3 } from 'three';
import { cableCrossing, cableTop, hoistEnd } from '../src/arena-cable-route.js';

test('hoisted cargo crosses both side edges with the cable end outside the frame', () => {
  for (const aspect of [.48, 1.8]) {
    const camera = new OrthographicCamera(-12 * aspect, 12 * aspect, 12, -12, .1, 130);
    camera.position.set(16, 24, 22);
    camera.lookAt(0, -.28, 0);
    for (const zoom of [.58, 1.2]) {
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      const deck = new Group();
      deck.position.y = .45;
      deck.rotation.set(.21, 0, -.29);
      deck.updateMatrixWorld();
      const matrix = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(deck.matrixWorld);
      for (const side of [-1, 1]) {
        const start = cableCrossing(matrix, side, 2, 3, 5.46, 0, 0, 2);
        const mid = cableCrossing(matrix, side, 2, 3, 5.46, 1, 0, 2);
        const land = cableCrossing(matrix, side, 2, 3, 5.46, 2, 0, 2);
        assert.deepEqual(land, { x: 2, z: 3 });
        const startClip = new Vector3(start.x, 5.46, start.z).applyMatrix4(matrix);
        const midClip = new Vector3(mid.x, 5.46, mid.z).applyMatrix4(matrix);
        assert.ok(side * startClip.x > 1.2);
        assert.ok(Math.abs(startClip.y - midClip.y) < 1e-8);
        const top = cableTop(matrix, mid.x, mid.z);
        assert.ok(new Vector3(mid.x, top, mid.z).applyMatrix4(matrix).y > 1);
        const exit = cableCrossing(matrix, side, 2, 3, 5.46, 3, 0, 2, 3);
        assert.ok(-side * new Vector3(exit.x, 5.46, exit.z).applyMatrix4(matrix).x > 1.2);
        assert.ok(hoistEnd(5.46, 1.35, 2.46, 1.57, 2) > 6.7);
      }
    }
  }
});
