import assert from 'node:assert/strict';
import {test} from 'node:test';
import {blockBox, blockCircle, BARREL_COLLIDER_RADIUS as radius} from '../shared/contact-geometry.mjs';
import {hazardPush,hazardTiming,placeArenaHazard} from '../shared/arena-hazards.mjs';

test('swept solid contact stops a barrel even when it crosses the whole obstacle in one step',()=>{
  for (const reverse of [1,-1]) {
    const p={stepX:-4*reverse,stepZ:0,x:4*reverse,z:0,vx:18*reverse,vz:0};
    assert.equal(blockBox({x:0,z:0},p,.5),true);
    assert.ok(p.x*reverse<=-(.5+radius)+1e-5);
    assert.equal(p.vx,0);
    const q={stepX:-4*reverse,stepZ:0,x:4*reverse,z:0,vx:18*reverse,vz:0};
    assert.equal(blockCircle({x:0,z:0},q,radius+.2),true);
    assert.ok(q.x*reverse<=-(radius+.2)+1e-5);
  }
});
test('solid corners use rounded barrel clearance and permit unobstructed movement',()=>{
  const p={stepX:3,stepZ:3,x:.8,z:.8,vx:-4,vz:-4};
  assert.equal(blockBox({x:0,z:0},p,.5),true);
  assert.ok(Math.hypot(p.x-.5,p.z-.5)>=radius-1e-6);
  const q={stepX:-4,stepZ:3,x:4,z:3,vx:18,vz:0};
  assert.equal(blockBox({x:0,z:0},q,.5),false);
  assert.equal(q.x,4);
});
test('moving participants crossing a projectile lane cannot tunnel through the sweep',()=>{
  const h=placeArenaHazard(hazardTiming('broadside',2),8,()=>.25).lanes[0];
  const t=h.fireAt+(h.end-h.fireAt)/2;
  const p={x:h.x-h.dz*4,z:h.z+h.dx*4,stepX:h.x+h.dz*4,stepZ:h.z-h.dx*4};
  assert.ok(hazardPush(h,t+.03,t-.03,p));
});

test('a swept crate or post keeps tangential escape instead of pinning the barrel', () => {
  const half = .49;
  const player = { stepX: -half - radius, stepZ: 0, x: -half - radius + .10, z: .4, vx: 1, vz: 4 };
  assert.equal(blockBox({x: 0, z: 0}, player, half), true);
  assert.ok(player.x <= -half - radius + 1e-6);
  assert.ok(player.z >= .39999, 'a diagonal escape retains its lateral movement');
  assert.equal(player.vx, 0);
  assert.equal(player.vz, 4);
  const post = { stepX: -1, stepZ: 0, x: -.8, z: .35, vx: 2, vz: 3 };
  assert.equal(blockCircle({x: 0, z: 0}, post, 1), true);
  assert.ok(post.z >= .34999);
  assert.ok(Math.hypot(post.x, post.z) >= 1);
});
