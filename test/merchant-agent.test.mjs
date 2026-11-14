import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decideMerchantTrade} from '../shared/merchant-agent.mjs';
const policy = {enabled:true,expires_at:10000,items:['seat-red'],budget:1000,spent:0,nonce:0,per_trade:500};
const quote = {item:'seat-red',count:8,buy:432,sell:240,discount:48};
test('reserve keeper acquires surplus and releases it only when players create scarcity',()=>{
  const decision=decideMerchantTrade({policy,quotes:[quote],owned:{},now:1});
  assert.equal(decision.action,'buy');assert.equal(decision.expected_price,432);
  assert.equal(decideMerchantTrade({policy,quotes:[quote],owned:{'seat-red':1},now:1}).action,'wait');
  const release=decideMerchantTrade({policy:{...policy,nonce:1,spent:432},quotes:[{...quote,count:3}],owned:{'seat-red':1},now:1});
  assert.equal(release.action,'sell');assert.equal(release.nonce,2);
});
test('reserve keeper waits for permission, funds and genuine surplus',()=>{
  for (const change of [{enabled:false},{expires_at:1},{spent:900},{per_trade:100},{items:['other']}])
    assert.equal(decideMerchantTrade({policy:{...policy,...change},quotes:[quote],owned:{},now:2}).action,'wait');
  for(const change of [{count:5},{discount:0}]) assert.equal(decideMerchantTrade({policy,quotes:[{...quote,...change}],owned:{},now:2}).action,'wait');
});
