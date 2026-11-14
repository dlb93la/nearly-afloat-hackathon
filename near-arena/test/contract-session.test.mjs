import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { decideMerchantTrade } from '../../shared/merchant-agent.mjs';

const wasm = new WebAssembly.Module(readFileSync(process.env.AFLOAT_CANDIDATE_WASM ?? new URL(
  '../target/wasm32-unknown-unknown/release/barrel_bay_arena.wasm', import.meta.url,
)));
const contract = 'arena.testnet';
const referee = 'referee.testnet';
const player = 'player.testnet';
const guest = 'guest.testnet';

test('rarity limits a closed supply and resale returns the same legendary unit',()=>{
  const {call,advance}=fixture();
  const quotes=()=>call('collection_quotes');
  for(const q of quotes()) {
    assert.equal(q.count,q.stock_limit);
    assert.equal(q.commercial_supply,q.stock_limit);
    assert.equal(q.circulating,0);
    assert.equal(q.legacy_circulation_untracked,false);
    assert.equal(q.wanted,false);
  }
  const item=quotes().find(q=>q.rarity==='legendary').item;
  const q=()=>quotes().find(q=>q.item===item);
  assert.equal(q().stock_limit,1);
  call('collection_action',{action:'buy',item,expected_price:q().buy},player);
  assert.equal(q().count,0);assert.equal(q().circulating,1);
  assert.throws(()=>call('collection_action',{action:'buy',item,expected_price:q().buy},guest),/stock/);
  advance(600000*10);
  assert.equal(q().count,0,'offer rotation must not mint');
  call('collection_action',{action:'sell',item,expected_price:q().sell},player);
  assert.equal(q().count,1);assert.equal(q().circulating,0);
  call('collection_action',{action:'buy',item,expected_price:q().buy},guest);
  assert.equal(q().count,0);
  assert.equal(call('collection',{player}).owned[item],undefined);
  assert.equal(call('collection',{player:guest}).owned[item],1);
});

test('loot uses confirmed unit weights and consumes the same commercial stock',()=>{
  const {call}=fixture();
  const quotes=()=>call('collection_quotes');
  const before=quotes();
  const first=before.find(q=>q.loot_weight>0);
  const balance=call('balance',{player});
  const chestPrice=call('chest_price');
  const awarded=call('collection_action',{action:'open_chest',expected_price:chestPrice},player);
  assert.equal(awarded.owned[first.item],1,'zero seed selects first weighted ticket');
  assert.equal(quotes().find(q=>q.item===first.item).count,first.count-1);
  assert.equal(call('balance',{player}),balance-chestPrice);
  const stock=quotes().find(q=>q.item===first.item);
  assert.equal(stock.circulating+stock.count,stock.commercial_supply);
});

test('500 mixed trade decisions conserve units and gold, and depleted loot prices cover resale expectation', t => {
  const { call, advance } = fixture();
  const wallets = Array.from({ length: 30 }, (_, i) => `economy-${i}.testnet`);
  for (const wallet of wallets) call('grant_test_gold', { player: wallet });
  const initial = call('collection_quotes');
  const totalGold = () => [...wallets, player, guest].reduce((sum, id) => sum + call('balance', { player: id }), 0) + call('pools')[0];
  const gold = totalGold();
  let seed = 31209;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const check = () => {
    const quotes = call('collection_quotes');
    const owned = wallets.map(id => call('collection', { player: id }).owned);
    for (const q of quotes) {
      assert.equal(q.count + owned.reduce((sum, bag) => sum + (bag[q.item] ?? 0), 0), q.commercial_supply, q.item);
    }
    assert.equal(totalGold(), gold);
    let weight = 0, expected = 0;
    for (const q of quotes.filter(q => q.loot_weight > 0 && q.count)) {
      const cap = q.stock_limit, count = q.count - 1, low = Math.max(1, Math.ceil(cap * 3 / 8));
      const index = initial.findIndex(item => item.item === q.item);
      // Quotes cover the generated catalog in the same order as the contract.
      const cycle = Math.floor(now / 600000);
      const normal = q.normal_sell;
      const premium = count < cap && count <= low && (cycle + index) % 3 === 0
        ? Math.floor(normal * (low + 1 - count) / (2 * (low + 1))) : 0;
      const resale = Math.min(normal + premium, q.buy - 1);
      const tickets = q.count * q.loot_weight;
      weight += tickets; expected += tickets * resale;
    }
    if (weight) assert.ok(call('chest_price') * weight * 100 >= expected * 110);
  };
  let now = 1000;
  const operations = { buy: 0, sell: 0, open_chest: 0 };
  for (let step = 0; step < 500; step++) {
    if (step % 35 === 0) { advance(600000); now += 600000; }
    const wallet = wallets[random(wallets.length)];
    const quotes = call('collection_quotes');
    const q = quotes[random(quotes.length)];
    const owned = call('collection', { player: wallet }).owned;
    const amount = call('balance', { player: wallet });
    if (owned[q.item] && q.count < q.stock_limit) {
      call('collection_action', { action: 'sell', item: q.item, expected_price: q.sell }, wallet);
      operations.sell++;
    } else if (step % 3 === 0 && amount >= call('chest_price')) {
      call('collection_action', { action: 'open_chest', expected_price: call('chest_price') }, wallet);
      operations.open_chest++;
    } else if (q.count && q.buy > 0 && amount >= q.buy) {
      call('collection_action', { action: 'buy', item: q.item, expected_price: q.buy }, wallet);
      operations.buy++;
    }
    if (step % 25 === 0) check();
  }
  check();
  t.diagnostic(JSON.stringify(operations));
});

test('merchant reserve comparison uses identical demand and contract prices', t => {
  const timelines = {
    quiet: [[3], [], [], [2], []],
    steady: [[1], [2], [3], [2], [2]],
    rush: [[5], [6], [], [2], [3]],
    restock: [[4], [3], [-3], [4], [3]],
  };
  const compare = (timeline, useReserve, phase) => {
    const { call, advance } = fixture();
    advance(phase * 600_000);
    const item = call('collection_quotes').find(quote => quote.count >= 6 && quote.discount > 0).item;
    const agent = 'reserve.testnet';
    const quote = () => call('collection_quotes').find(entry => entry.item === item);
    const buyers = Array.from({ length: 24 }, (_, i) => `buyer-${i}.testnet`);
    for (const wallet of [...buyers, agent]) call('grant_test_gold', { player: wallet });
    if (useReserve) call('configure_agent', { agent, items: [item], budget: 1_500, per_trade: 650,
      expires_at: (phase + 30) * 600_000, enabled: true });
    const policy = () => call('agent_policy', { agent });
    const results = { item, filled: 0, missed: 0, zeroStockWindows: 0, playerSpent: 0, playerSales: 0, reserveNetCost: 0 };
    const queue = [];
    let nextBuyer = 0;
    const runReserve = () => {
      if (!useReserve) return;
      const decision = decideMerchantTrade({ policy: policy(), quotes: [quote()],
        owned: call('collection', { player: agent }).owned, now: 1_000 });
      if (decision.action !== 'wait') call('agent_trade', { action: decision.action, item,
        expected_price: decision.expected_price, nonce: decision.nonce }, agent);
    };
    for (const window of timeline) {
      runReserve();
      for (const amount of window) {
        if (amount < 0) {
          for (let i = 0; i < -amount && queue.length; i++) {
            const sell = quote().sell;
            call('collection_action', { action: 'sell', item, expected_price: sell }, queue.shift());
            results.playerSales += sell;
          }
        } else {
          for (let i = 0; i < amount; i++) {
            const wallet = buyers[nextBuyer++];
            const current = quote();
            if (current.count === 0) { results.missed++; continue; }
            call('collection_action', { action: 'buy', item, expected_price: current.buy }, wallet);
            results.filled++;
            results.playerSpent += current.buy;
            queue.push(wallet);
          }
        }
      }
      if (!quote().count) results.zeroStockWindows++;
      advance(600_000);
    }
    const reserved = useReserve ? policy() : null;
    results.reserveNetCost = reserved ? reserved.spent - reserved.revenue : 0;
    results.remainingStock = quote().count;
    results.reserveInventory = call('collection', { player: agent }).owned[item] ?? 0;
    assert.equal(results.remainingStock + results.reserveInventory + queue.length, quote().commercial_supply);
    return results;
  };
  const results = {};
  for (const [name, timeline] of Object.entries(timelines)) {
    const pairs = Array.from({ length: 7 }, (_, phase) => [compare(timeline, false, phase), compare(timeline, true, phase)]);
    assert.ok(pairs.every(([control, reserve]) => control.item === reserve.item));
    const fields = ['filled', 'missed', 'zeroStockWindows', 'playerSpent', 'playerSales', 'reserveNetCost', 'remainingStock', 'reserveInventory'];
    results[name] = [0, 1].map(group => Object.fromEntries(fields.map(field =>
      [field, pairs.reduce((sum, pair) => sum + pair[group][field], 0)])));
  }
  t.diagnostic(JSON.stringify(results));
});

test('repeated Mythic wins preserve separate campaign editions and all owned copies',()=>{
  const {call,advance}=fixture();
  const item='pet-expedition-parrot';
  for(let campaign=0;campaign<2;campaign++){
    call('new_voyage',{funding_ms:5000,sailing_ms:1000,auction_ms:1000,item_type:item});
    call('contribute',{amount:600,nonce:campaign+1,campaign_id:campaign},player);
    call('contribute',{amount:2400,nonce:campaign+1,campaign_id:campaign},guest);
    advance(1000);call('bid',{amount:100,campaign_id:campaign},player);
    advance(1000);call('advance',{campaign_id:campaign});
    call('advance',{campaign_id:campaign});
  }
  const account=call('account',{player});
  assert.equal(account.award_counts[item],2);
  assert.deepEqual(account.award_editions.map(e=>e.campaign_id),[0,1]);
  assert.equal(call('collection',{player}).owned[item],2);
});

test('pre-balance upgrade preserves inventory and declares circulation unknown', {skip:!process.env.AFLOAT_PREVIOUS_WASM},()=>{
  const previous=new WebAssembly.Module(readFileSync(process.env.AFLOAT_PREVIOUS_WASM));
  const {call,upgrade}=fixture(previous);
  const item='pirate-2-0';
  const old=call('collection_quotes').find(q=>q.item===item);
  call('collection_action',{action:'buy',item,expected_price:old.buy},player);
  const balance=call('balance',{player});
  upgrade();
  const quote=call('collection_quotes').find(q=>q.item===item);
  assert.equal(call('balance',{player}),balance);
  assert.equal(call('collection',{player}).owned[item],1);
  assert.equal(quote.legacy_circulation_untracked,true);
  assert.equal(quote.commercial_supply,null);
  assert.equal(quote.circulating,null);
  assert.ok(quote.count<=quote.stock_limit);
});

test('upgrade retains the agent policy, spending and operation sequence', {skip:!process.env.AFLOAT_PREVIOUS_WASM}, () => {
  const previous=new WebAssembly.Module(readFileSync(process.env.AFLOAT_PREVIOUS_WASM));
  const {call,upgrade}=fixture(previous);
  const item='seat-red';
  const price=call('collection_quotes').find(q=>q.item===item).buy;
  call('configure_agent',{agent:player,items:[item],budget:1000,per_trade:500,expires_at:50000,enabled:true});
  call('agent_trade',{action:'buy',item,expected_price:price,nonce:1},player);
  const state={policy:call('agent_policy',{agent:player}),balance:call('balance',{player}),
    owned:call('collection',{player}).owned};
  upgrade();
  assert.deepEqual(call('agent_policy',{agent:player}),state.policy);
  assert.equal(call('balance',{player}),state.balance);
  assert.deepEqual(call('collection',{player}).owned,state.owned);
  assert.throws(()=>call('agent_trade',{action:'buy',item,expected_price:price,nonce:1},player),/Agent nonce changed/);
});

test('agent limits hold on-chain without the server and survive reconfiguration', () => {
  const {call,advance}=fixture();
  const item='seat-red';
  const quote=()=>call('collection_quotes').find(q=>q.item===item);
  const args={agent:player,items:[item],budget:1000,per_trade:500,expires_at:50000,enabled:true};
  const configure=(changes={})=>call('configure_agent',{...args,...changes});
  assert.throws(()=>call('configure_agent',args,player));
  configure();
  const trade=(action='buy',changes={})=>call('agent_trade',{action,item,expected_price:action==='buy'?quote().buy:quote().sell,nonce:1,...changes},player);
  const before=call('balance',{player}), paid=quote().buy;
  assert.equal(trade().spent,paid);
  assert.equal(call('balance',{player}),before-paid);
  assert.equal(call('collection',{player}).owned[item],1);
  assert.throws(()=>trade(),/nonce/);
  assert.throws(()=>trade('buy',{nonce:2}),/stocked/);
  assert.throws(()=>trade('sell',{nonce:2,item:'pet-cat-0'}),/forbidden/);
  assert.throws(()=>trade('equip',{nonce:2}),/forbidden/);
  assert.throws(()=>trade('sell',{nonce:2,expected_price:1}),/quote/);
  assert.throws(()=>trade('buy',{nonce:2,expected_price:999}),/limit/);
  assert.equal(call('agent_policy',{agent:player}).nonce,1);
  const earned=quote().sell;
  trade('sell',{nonce:2});
  assert.equal(call('agent_policy',{agent:player}).revenue,earned);
  assert.equal(call('balance',{player}),before-paid+earned);
  configure({budget:paid,per_trade:paid});
  assert.throws(()=>trade('buy',{nonce:3}),/budget/);
  configure({enabled:false});
  assert.throws(()=>trade('buy',{nonce:3}),/inactive/);
  configure();advance(50000);
  assert.throws(()=>trade('buy',{nonce:3}),/inactive/);
  assert.equal(call('agent_policy',{agent:player}).spent,paid);
});

test('successive voyages preserve prizes, archive shares and reject stale campaign actions', () => {
  const { call, advance } = fixture();
  const windows = { funding_ms: 5000, sailing_ms: 1000, auction_ms: 1000 };
  const first = 'pet-expedition-parrot';
  const second = 'ornament-expedition-astrolabe';
  call('new_voyage', { ...windows, item_type: first });
  call('contribute', { amount: 600, nonce: 1 }, player);
  call('contribute', { amount: 2400, nonce: 1 }, guest);
  advance(1000); call('bid', { amount: 1000 }, guest);
  advance(1000); call('advance');
  call('equip_voyage_award', { equipped: true }, guest);
  const balance = call('balance', { player: guest });
  assert.equal(call('new_voyage', { ...windows, item_type: second }).id, 1);
  assert.equal(call('balance', { player: guest }), balance);
  assert.deepEqual(call('account', { player: guest }).awards, [first]);
  assert.equal(call('account', { player: guest }).award, first);
  assert.equal(call('account', { player: guest }).award_equipped, true);
  assert.equal(call('account', { player: guest }).contribution, 0);
  assert.equal(call('campaign_participation', { campaign_id: 0, player: guest }).contribution, 2400);
  assert.equal(call('campaign_history')[0].item_type, first);
  for (const method of ['bid', 'advance', 'contribute']) assert.throws(() => call(method, { amount: 600, nonce: 2, campaign_id: 0 }, guest));
  call('contribute', { amount: 600, nonce: 2, campaign_id: 1 }, player);
  call('contribute', { amount: 2400, nonce: 2, campaign_id: 1 }, guest);
  advance(1000); call('bid', { amount: 500, campaign_id: 1 }, guest);
  advance(1000); call('advance', { campaign_id: 1 });
  assert.deepEqual(call('account', { player: guest }).awards, [first, second]);
  assert.equal(call('equip_voyage_award', { equipped: true, item: first }, guest).award, first);
  call('new_voyage', windows);
  assert.deepEqual(call('campaign_history').map(c => c.id), [1, 0]);
  call('contribute', { amount: 100, nonce: 3, campaign_id: 2 }, guest);
  advance(5000); call('advance', { campaign_id: 2 });
  const refunded = call('balance', { player: guest });
  call('new_voyage', windows);
  assert.equal(call('balance', { player: guest }), refunded);
  assert.equal(call('campaign_participation', { campaign_id: 2, player: guest }).refund, 100);
});

test('wanted prices follow low stock, rotate and reject a stale resale quote', () => {
  const { call, advance } = fixture();
  const quotes = () => call('collection_quotes');
  const item = quotes().find(q => q.stock_limit === 8).item;
  const quote = () => quotes().find(q => q.item === item);
  assert.equal(quote().wanted, false);
  for (let i = 0; i < 6; i++) call('collection_action', { action: 'buy', item, expected_price: quote().buy }, player);
  for (let i = 0; i < 3 && !quote().wanted; i++) advance(600000);
  const wanted = quote();
  assert.equal(wanted.wanted, true);
  assert.ok(wanted.sell > wanted.normal_sell);
  const balance = call('balance', { player });
  call('collection_action', { action: 'sell', item, expected_price: wanted.sell }, player);
  assert.equal(call('balance', { player }), balance + wanted.sell);
  assert.equal(quote().count, wanted.count + 1);
  assert.ok(wanted.sell < quote().buy);
  assert.ok(quote().sell < wanted.sell);
  assert.throws(() => call('collection_action', { action: 'sell', item, expected_price: wanted.sell }, player));
});

test('an early-sailing voyage cannot donate its deadline alias to the next campaign', () => {
  const { call, advance } = fixture();
  const first = call('new_voyage', { funding_ms: 10000, sailing_ms: 1000, auction_ms: 1000, target: 200 });
  call('contribute', { amount: 100, nonce: 1 }, player);
  call('contribute', { amount: 100, nonce: 1 }, guest);
  advance(1000); call('bid', { amount: 100 }, guest);
  advance(1000); call('advance');
  assert.throws(() => call('new_voyage', { funding_ms: 8000, sailing_ms: 1000, auction_ms: 1000 }));
  const next = call('new_voyage', { funding_ms: 8001, sailing_ms: 1000, auction_ms: 1000 });
  assert.equal(next.id, 1);
  assert.notEqual(next.funding_ends_at, first.funding_ends_at);
  assert.throws(() => call('contribute', { amount: 100, nonce: 2, campaign_id: first.funding_ends_at }, player));
});

// Minimal host for exercising the compiled ABI and storage. Register and trie
// semantics follow https://near.github.io/nearcore/RuntimeSpec/Components/BindingsSpec/RegistersAPI.html
export function fixture(initialModule = wasm, backed = false) {
  let activeModule = initialModule;
  let storage = new Map();
  const logs = [];
  let now = 1_000;

  function call(method, args, account = referee) {
    const transaction = new Map(storage);
    const registers = new Map();
    let output;
    let instance;
    const bytes = () => new Uint8Array(instance.exports.memory.buffer);
    const read = (length, pointer) => length === -1n ? registers.get(pointer)
      : bytes().slice(Number(pointer), Number(pointer + length));
    const key = (length, pointer) => Buffer.from(read(length, pointer)).toString('hex');
    const readStorage = (length, pointer, register) => {
      const value = transaction.get(key(length, pointer));
      if (!value) return 0n;
      registers.set(register, value);
      return 1n;
    };
    instance = new WebAssembly.Instance(activeModule, { env: {
      // Synchronous fixture. Resolve the linked async imports, but fail if a
      // test actually calls one. Cross-contract GOLD flows use signed Sandbox.
      ...Object.fromEntries(WebAssembly.Module.imports(activeModule).filter(entry => entry.name.startsWith('promise_'))
        .map(entry => [entry.name, () => { throw new Error('Use signed Sandbox to test ' + entry.name); }])),
      value_return(length, pointer) { output = Buffer.from(read(length, pointer)).toString(); },
      current_account_id(register) { registers.set(register, Buffer.from(contract)); },
      predecessor_account_id(register) { registers.set(register, Buffer.from(account)); },
      attached_deposit(pointer) { bytes().fill(0, Number(pointer), Number(pointer) + 16); },
      block_timestamp() { return BigInt(now) * 1_000_000n; },
      input(register) { registers.set(register, Buffer.from(JSON.stringify(args ?? {}))); },
      register_len(register) { return registers.has(register) ? BigInt(registers.get(register).length) : -1n; },
      read_register(register, pointer) { bytes().set(registers.get(register), Number(pointer)); },
      random_seed(register) { registers.set(register, Buffer.alloc(32)); },
      log_utf8(length, pointer) { logs.push(Buffer.from(read(length, pointer)).toString('utf8')); },
      panic() { throw new Error('NEAR contract panicked'); },
      panic_utf8(length, pointer) { throw new Error(Buffer.from(read(length, pointer)).toString('utf8')); },
      storage_has_key(length, pointer) { return transaction.has(key(length, pointer)) ? 1n : 0n; },
      storage_read: readStorage,
      storage_write(length, pointer, valueLength, valuePointer, register) {
        const replaced = readStorage(length, pointer, register);
        transaction.set(key(length, pointer), read(valueLength, valuePointer));
        return replaced;
      },
      storage_remove(length, pointer, register) {
        const removed = readStorage(length, pointer, register);
        transaction.delete(key(length, pointer));
        return removed;
      },
    } });
    instance.exports[method]();
    storage = transaction;
    return output === undefined ? undefined : JSON.parse(output);
  }

  if (backed) {
    call('new_with_gold', { referee, token: 'gold.testnet', funder: referee }, contract);
    call('ft_on_transfer', { sender_id: referee, amount: '1000000', msg: 'treasury' }, 'gold.testnet');
  } else call('new', { referee }, contract);
  for (const id of [player, guest]) call('grant_test_gold', { player: id });
  return { call, logs, advance: ms => { now += ms; }, upgrade: () => { activeModule = wasm; } };
}

test('upgrading the previous deployed WASM preserves balances and freezes its legacy prize', { skip: !process.env.AFLOAT_PREVIOUS_WASM }, () => {
  const previous = new WebAssembly.Module(readFileSync(process.env.AFLOAT_PREVIOUS_WASM));
  const { call, advance, upgrade } = fixture(previous);
  const windows = { funding_ms: 5000, sailing_ms: 1000, auction_ms: 1000 };
  call('new_voyage', windows);
  call('contribute', { amount: 600, nonce: 1 }, player);
  call('contribute', { amount: 2400, nonce: 1 }, guest);
  advance(1000); call('bid', { amount: 1000 }, guest);
  advance(1000); call('advance');
  call('equip_voyage_award', { equipped: true }, guest);
  const balance = call('balance', { player: guest });
  upgrade();
  call('new_voyage', { ...windows, item_type: 'ornament-expedition-astrolabe' });
  const account = call('account', { player: guest });
  assert.equal(account.balance, balance);
  assert.equal(account.award, 'pet-expedition-parrot');
  assert.equal(account.award_equipped, true);
  assert.deepEqual(account.awards, ['pet-expedition-parrot']);
  assert.equal(call('campaign_history')[0].item_type, 'pet-expedition-parrot');
});

test('the legacy reserve_round payload still works without session arguments', () => {
  const { call } = fixture();
  call('authorize_entry', { round_id: '1' }, player);
  const round = call('reserve_round', { round_id: '1', players: [player], slots: 6 });
  assert.equal(round.status, 'reserved');
  assert.equal(call('entry_consent', { player, round_id: '1' }), null);
  assert.equal(call('balance', { player }), 9800);
});

test('a pass permits three reservations in its scope, including a mixed roster', () => {
  const { call } = fixture();
  assert.throws(() => call('authorize_session', { scope: '19', entries: 4 }, player));
  call('authorize_session', { scope: '19', entries: 3 }, player);
  const use = (id, scope, players = [player]) => call('reserve_round', {
    round_id: id, players, slots: 6, session: { scope, players: [player] },
  });
  const remaining = () => call('entry_session', { player, scope: '19' })?.remaining ?? 0;
  assert.throws(() => use('1', '20'));
  assert.throws(() => use('1', '19', [player, guest]));
  assert.equal(remaining(), 3);
  assert.equal(call('balance', { player }), 10_000);
  call('authorize_entry', { round_id: '1' }, guest);
  assert.equal(use('1', '19', [player, guest]).status, 'reserved');
  assert.equal(call('balance', { player: guest }), 9_800);
  assert.equal(remaining(), 2);
  assert.throws(() => use('1', '19'));
  assert.equal(remaining(), 2);
  use('2', '19');
  use('3', '19');
  assert.equal(remaining(), 0);
  assert.throws(() => use('4', '19'));
  assert.equal(call('balance', { player }), 9400);
});

test('expiry, revocation, and cancellation preserve entry limits', () => {
  const { call, advance } = fixture();
  const use = id => call('reserve_round', {
    round_id: id, players: [player], slots: 6, session: { scope: '21', players: [player] },
  });
  call('authorize_session', { scope: '21', entries: 3 }, player);
  call('revoke_session', { scope: '99' }, player);
  use('1');
  assert.equal(call('cancel_round', { round_id: '1' }).status, 'cancelled');
  assert.equal(call('balance', { player }), 10_000);
  assert.equal(call('entry_session', { player, scope: '21' }).remaining, 2);
  call('revoke_session', { scope: '21' }, player);
  assert.throws(() => use('2'));
  call('authorize_session', { scope: '21', entries: 3 }, player);
  advance(600_000);
  assert.equal(call('entry_session', { player, scope: '21' }), null);
  assert.throws(() => use('2'));
});

test('the same NEAR gold buys a rig and enters paid rounds with it', () => {
  const { call, logs, advance } = fixture();
  const shop = (id = player) => call('workshop', { player: id });
  const action = (action, rig, options = {}, id = player) =>
    call('workshop_action', { action, rig, ...options }, id);
  const quote = (rig, id = player) => shop(id).stock.find(item => item.rig === rig);
  const buy = rig => action('buy', rig, { expected_price: quote(rig).buy });
  const reserve = id => {
    call('authorize_entry', { round_id: id }, player);
    return call('reserve_round', { round_id: id, players: [player], slots: 6 });
  };
  const settle = id => call('settle_round', { round_id: id, winner: player });

  const iron = quote('iron');
  assert.throws(() => action('buy', 'iron', { expected_price: iron.buy + 1 }));
  buy('iron');
  assert.equal(shop().gold, 10_000 - iron.buy);
  assert.equal(quote('iron', guest).count, iron.count - 1);
  assert.ok(quote('iron', guest).buy > iron.buy);
  action('equip', 'iron');

  reserve('100');
  assert.deepEqual(call('round_rigs', { round_id: '100' }), { [player]: 'iron' });
  assert.equal(shop().gold, 10_000 - iron.buy - 200);
  assert.equal(shop().items[0].locked, true);
  assert.throws(() => action('sell', 'iron', { expected_price: quote('iron').sell }));
  assert.throws(() => reserve('101'));
  call('cancel_round', { round_id: '100' });
  assert.equal(shop().gold, 10_000 - iron.buy);
  assert.equal(shop().items[0].uses, 3);

  reserve('102');
  advance(90_000);
  call('expire_round', { round_id: '102' }, guest);
  assert.equal(shop().items[0].locked, false);
  assert.equal(shop().items[0].uses, 3);

  for (const id of ['103', '104', '105']) {
    reserve(id);
    settle(id);
    settle(id);
  }
  assert.equal(shop().equipped, 'oak');
  assert.equal(shop().items[0].uses, 0);
  assert.throws(() => action('recycle', 'iron'));
  const beforeRepair = shop().gold;
  action('repair', 'iron', { expected_price: 175 });
  assert.equal(shop().gold, beforeRepair - 175);
  action('equip', 'iron');
  reserve('106');
  settle('106');
  action('recycle', 'iron');
  assert.equal(shop().scrap, 1);

  buy('cork');
  action('equip', 'cork');
  reserve('107');
  settle('107');
  const beforeScrapRepair = shop().gold;
  action('repair', 'cork', { use_scrap: true });
  assert.equal(shop().scrap, 0);
  assert.equal(shop().gold, beforeScrapRepair);
  const cork = quote('cork');
  action('sell', 'cork', { expected_price: cork.sell });
  assert.equal(shop().gold, beforeScrapRepair + cork.sell);
  assert.equal(quote('cork', guest).count, cork.count + 1);

  const events = logs.filter(log => log.startsWith('EVENT_JSON:'))
    .map(log => JSON.parse(log.slice('EVENT_JSON:'.length)));
  assert.equal(events.filter(event => event.event === 'barrel_wear').length, 5);
  assert.equal(events.filter(event => event.event === 'arena_refunded').length, 2);
  assert.ok(events.some(event => event.event === 'workshop_action' && event.data[0].scrap_delta === -1));
});

test('Expeditions escrows, pays and equips from the same ledger as Arena and Workshop', () => {
  const { call, advance, logs } = fixture();
  const account = player => call('account', { player });
  const balance = player => call('balance', { player });
  const windows = { funding_ms: 10_000, sailing_ms: 1_000, auction_ms: 1_000 };
  assert.throws(() => call('new_voyage', windows, guest));
  assert.equal(call('new_voyage', windows).target, 3_000);
  assert.throws(() => call('new_voyage', windows));

  call('contribute', { amount: 600, nonce: 1 }, player);
  call('contribute', { amount: 600, nonce: 1 }, player);
  assert.equal(balance(player), 9_400);
  assert.equal(call('campaign').status, 'funding');
  assert.throws(() => call('contribute', { amount: 2_400, nonce: 2 }, player));
  assert.equal(call('contribute', { amount: 2_400, nonce: 1 }, guest).status, 'sailing');
  assert.equal(call('pools')[0], 13_000);

  advance(1_000);
  call('bid', { amount: 200 }, player);
  assert.equal(balance(player), 9_200);
  call('bid', { amount: 2_000 }, guest);
  assert.equal(balance(player), 9_400);
  assert.equal(balance(guest), 5_600);
  assert.throws(() => call('equip_voyage_award', { equipped: true }, guest));

  advance(1_000);
  assert.equal(call('advance', {}, player).status, 'settled');
  assert.equal(account(player).payout, 380);
  assert.equal(account(guest).payout, 1_520);
  assert.equal(balance(guest), 7_120);
  call('advance', {}, player);
  assert.equal(balance(guest), 7_120);
  assert.equal(call('voyage_award', { player: guest }), 'pet-expedition-parrot');
  assert.throws(() => call('equip_voyage_award', { equipped: true }, player));
  assert.equal(call('equip_voyage_award', { equipped: true }, guest).award_equipped, true);

  const workshop = call('workshop', { player: guest });
  assert.equal(workshop.gold, account(guest).balance);
  const cork = workshop.stock.find(quote => quote.rig === 'cork');
  call('workshop_action', { action: 'buy', rig: 'cork', expected_price: cork.buy }, guest);
  call('workshop_action', { action: 'equip', rig: 'cork' }, guest);
  call('authorize_entry', { round_id: '201' }, guest);
  call('reserve_round', { round_id: '201', players: [guest], slots: 6 });
  assert.equal(account(guest).balance, 7_120 - cork.buy - 200);
  assert.deepEqual(call('round_rigs', { round_id: '201' }), { [guest]: 'cork' });
  assert.equal(logs.filter(log => log.includes('"event":"voyage_settled"')).length, 1);
});

test('a 99 GOLD sale splits 20/10 contributions after the 5 percent fee exactly once', () => {
  const { call, advance } = fixture();
  const buyer = 'buyer99.testnet';
  call('grant_test_gold', { player: buyer });
  call('new_voyage', { funding_ms: 5000, sailing_ms: 1000, auction_ms: 1000 });
  call('contribute', { amount: 2000, nonce: 1 }, player);
  call('contribute', { amount: 1000, nonce: 1 }, guest);
  advance(1000);
  call('bid', { amount: 9900 }, buyer);
  advance(1000);
  const campaign = call('advance', {}, buyer);
  assert.equal(campaign.sale, 9900);
  assert.equal(campaign.fee, 495);
  assert.equal(campaign.net, 9405);
  assert.equal(call('account', { player }).payout, 6270);
  assert.equal(call('account', { player: guest }).payout, 3135);
  assert.equal(call('balance', { player: buyer }), 100);
  assert.equal(call('pools')[0], 13495);
  call('advance', {}, buyer);
  assert.equal(call('account', { player }).payout, 6270);
  assert.equal(call('balance', { player }), 14270);
  assert.equal(call('balance', { player: guest }), 12135);
  assert.equal(call('voyage_award', { player: buyer }), 'pet-expedition-parrot');
});

test('an expired voyage returns shared gold once and grants no cargo', () => {
  const { call, advance } = fixture();
  call('new_voyage', { funding_ms: 1_000, sailing_ms: 1_000, auction_ms: 1_000 });
  call('contribute', { amount: 600, nonce: 1 }, player);
  assert.equal(call('balance', { player }), 9_400);
  advance(1_000);
  assert.equal(call('advance', {}, guest).status, 'refunded');
  assert.equal(call('account', { player }).refund, 600);
  assert.equal(call('workshop', { player }).gold, 10_000);
  call('advance', {}, guest);
  assert.equal(call('balance', { player }), 10_000);
  assert.equal(call('voyage_award', { player }), null);
});

test('the referee can grant one bound starter without debiting gold or merchant stock', () => {
  const { call, logs } = fixture();
  const shop = () => call('workshop', { player });
  const reward = { player, rig: 'iron' };
  const before = shop();
  assert.throws(() => call('grant_first_brawl', reward, player));
  assert.equal(call('first_brawl_reward', { player }), null);
  const granted = call('grant_first_brawl', reward);
  assert.equal(granted.gold, before.gold);
  assert.deepEqual(granted.stock, before.stock);
  assert.equal(granted.equipped, 'iron');
  assert.equal(granted.items[0].starter, true);
  assert.equal(call('first_brawl_reward', { player }), 'iron');
  assert.throws(() => call('workshop_action', {
    action: 'sell', rig: 'iron', expected_price: granted.stock[0].sell,
  }, player));
  call('authorize_entry', { round_id: '300' }, player);
  call('reserve_round', { round_id: '300', players: [player], slots: 6 });
  call('settle_round', { round_id: '300', winner: player });
  assert.equal(call('grant_first_brawl', reward).items[0].uses, 2);
  assert.throws(() => call('grant_first_brawl', { player, rig: 'cork' }));
  assert.equal(logs.filter(log => log.includes('"event":"first_brawl_reward"')).length, 1);
});

test('cosmetics, décor and loot use the shared ledger and respect ownership', () => {
  const { call, logs } = fixture();
  const action = (action, item, slot, account = player) => call('collection_action', { action, item, slot,
    ...(action === 'open_chest' ? {expected_price:call('chest_price')} : {}) }, account);
  const initial = call('balance', { player });
  assert.throws(() => action('equip', 'seat-red'));
  assert.throws(() => action('buy', 'ornament-scrap'));
  assert.throws(() => action('buy', 'pet-expedition-parrot'));
  assert.equal(call('balance', { player }), initial);
  assert.equal(action('buy', 'seat-red').owned['seat-red'], 1);
  assert.equal(action('equip', 'seat-red').equipped.seat, 'seat-red');
  assert.throws(() => action('equip', 'seat-red', undefined, guest));
  assert.equal(action('open_chest').owned['pirate-0-0'], 1);
  assert.equal(call('workshop', { player }).gold, initial - 480 - 900);
  action('sell', 'seat-red');
  assert.equal(call('balance', { player }), initial - 480 - 900 + 240);
  assert.equal(call('collection', { player }).equipped.seat, undefined);
  assert.equal(action('buy', 'ornament-compass').owned['ornament-compass'], 1);
  assert.equal(action('equip', 'ornament-compass').equipped.ornament, 'ornament-compass');
  assert.ok(logs.some(log => log.includes('"event":"collection_action"')));
});

test('the expanded workshop reserves commercial rigs and bounds the wallet logbook', () => {
  const { call } = fixture();
  const shop = () => call('workshop', { player });
  assert.equal(shop().stock.length, 8);
  assert.throws(() => call('grant_first_brawl', { player, rig: 'anchor' }));
  const { buy } = shop().stock.find(item => item.rig === 'anchor');
  call('workshop_action', { action: 'buy', rig: 'anchor', expected_price: buy }, player);
  for (let index = 0; index < 20; index++) {
    call('workshop_action', { action: 'equip', rig: index % 2 ? 'anchor' : 'oak' }, player);
  }
  call('authorize_entry', { round_id: '500' }, player);
  call('reserve_round', { round_id: '500', players: [player], slots: 6 });
  assert.deepEqual(call('round_rigs', { round_id: '500' }), { [player]: 'anchor' });
  call('cancel_round', { round_id: '500' });
  const log = call('logbook', { player });
  assert.equal(log.length, 12);
  assert.equal(log.at(-2).gold_delta, -200);
  assert.equal(log.at(-1).gold_delta, 200);
  assert.equal(log.at(-1).round_id, '500');
  assert.equal(call('logbook', { player: guest }).length, 1);
});

test('a voyage advertises its chosen treasure and only its winner can equip it', () => {
  const { call, advance } = fixture();
  const windows = { funding_ms: 5_000, sailing_ms: 1_000, auction_ms: 1_000 };
  const item_type = 'ornament-expedition-astrolabe';
  assert.throws(() => call('new_voyage', { ...windows, item_type: 'seat-red' }));
  assert.equal(call('new_voyage', { ...windows, item_type }).item_type, item_type);
  call('contribute', { amount: 600, nonce: 1 }, player);
  call('contribute', { amount: 2_400, nonce: 1 }, guest);
  advance(1_000);
  call('bid', { amount: 200 }, guest);
  advance(1_000);
  assert.equal(call('advance').item_type, item_type);
  assert.equal(call('voyage_award', { player: guest }), item_type);
  assert.equal(call('voyage_award', { player }), null);
  assert.throws(() => call('equip_voyage_award', { equipped: true }, player));
  const equipped = call('equip_voyage_award', { equipped: true }, guest);
  assert.deepEqual([equipped.award, equipped.award_equipped], [item_type, true]);
});

test('free paints equip without stock and premium paint trades respect the limit and quote window', () => {
  const { call, advance } = fixture();
  const action = (action, item, expected_price, wallet = player) =>
    call('collection_action', { action, item, expected_price }, wallet);
  const quotes = () => call('collection_quotes');
  const paint = 'paint-tide';
  const quote = () => quotes().find(item => item.item === paint);
  assert.equal(quotes().some(item => item.item === 'paint-blue'), false);
  assert.equal(action('equip', 'paint-blue').equipped.barrelPaint, 'paint-blue');
  assert.equal(call('balance', { player }), 10_000);
  assert.throws(() => action('buy', 'paint-blue'));
  assert.throws(() => action('sell', 'paint-blue'));
  assert.throws(() => action('equip', paint));

  const discounts = () => quotes().filter(item => item.discount).map(item => item.item);
  const original = discounts();
  advance(598_999);
  assert.deepEqual(discounts(), original);
  advance(1);
  assert.notDeepEqual(discounts(), original);

  const initial = quote();
  assert.throws(() => action('buy', paint, initial.buy + 1));
  for (let index = 0; index < initial.count; index++) action('buy', paint, initial.buy);
  assert.equal(quote().count, 0);
  assert.throws(() => action('buy', paint, initial.buy, guest));
  assert.equal(action('equip', paint).equipped.barrelPaint, paint);
  action('sell', paint, initial.sell);
  assert.equal(quote().count, 1);
  action('buy', paint, initial.buy, guest);
  assert.equal(quote().count, 0);
});
