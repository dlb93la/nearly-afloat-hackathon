import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameSampler } from '../src/performance-meter.js';

test('device sampler bounds its window and distinguishes 60Hz from slow frames', () => {
  const meter = createFrameSampler();
  assert.equal(meter.read(), null);
  for (let index = 0; index < 240; index++) meter.sample(1 / 60);
  assert.equal(meter.read().frames, 120);
  assert.ok(Math.abs(meter.read().fps - 60) < .001);
  for (let index = 0; index < 12; index++) meter.sample(.05);
  assert.equal(meter.read().slowFrames, 12);
  assert.equal(meter.read().p95, 50);
  assert.ok(meter.read().fps < 60);
  meter.sample(5); meter.sample(0); meter.sample(NaN);
  assert.equal(meter.read().frames, 120);
  meter.reset();
  assert.equal(meter.read(), null);
});
