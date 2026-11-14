import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash,randomBytes} from 'node:crypto';
import {test} from 'node:test';
import {Account,actions,JsonRpcProvider,KeyPair,KeyPairSigner,baseDecode,baseEncode,createTransaction,getTransactionLastResult} from 'near-api-js';
import {loadMerchantAgent} from '../../merchant-agent.mjs';
import {lockAgentFile} from '../../agent-journal.mjs';
import {provisionMerchantReserve} from '../../agent-provision.mjs';

test('limited economic agent buys surplus, replenishes scarce stock, and cannot escape its policy', {timeout:process.env.AFLOAT_AGENT_REHEARSAL?900000:240000}, async t=>{
  const rehearsalFile=process.env.AFLOAT_AGENT_REHEARSAL;
  const config=rehearsalFile?JSON.parse(await readFile(rehearsalFile,'utf8')):null;
  const reuse=process.env.AFLOAT_AGENT_REUSE?JSON.parse(await readFile(process.env.AFLOAT_AGENT_REUSE,'utf8')):null;
  const backedGold=process.env.AFLOAT_AGENT_GOLD==='1';
  const {GenesisAccount,Sandbox}=config?{}:await import('near-sandbox');
  const suffix=config?randomBytes(4).toString('hex'):null;
  const identities=['arena','agent','alice'].map((name,index)=>{
    if(config){
      if(index===0 && reuse)return {id:reuse.contract,key:KeyPair.fromString(reuse.adminKey)};
      if(index===1 && reuse?.agent && reuse.ownerKey)return {id:reuse.agent,key:KeyPair.fromString(reuse.ownerKey)};
      const id=index===2?config.alice.id:`${index===0?'s':'a'}-${suffix}.${config.id}`;
      const key=index===2?KeyPair.fromString(config.alice.key):KeyPair.fromRandom('ed25519');
      return {id,key};
    }
    const id=name+'.testnet',key=KeyPair.fromRandom('ed25519');
    return {id,key,genesis:new GenesisAccount(id,key.getPublicKey().toString(),key.toString(),30n*10n**24n)};
  });
  const sandbox=config?null:await Sandbox.start({version:'2.14.0',config:{additionalAccounts:identities.map(i=>i.genesis)}});
  if(sandbox)t.after(()=>sandbox.tearDown());
  const rpcUrl=config?(process.env.AFLOAT_AGENT_RPC||'https://testnet-rpc.intea.rs'):sandbox.rpcUrl;
  const rpc=new JsonRpcProvider({url:rpcUrl},{retries:5,wait:350,backoff:1.7});
  if(config){
    const request=rpc.sendJsonRpc.bind(rpc);
    rpc.sendJsonRpc=async(method,params)=>{
      for(let attempt=0;attempt<6;attempt++){
        try{return await request(method,params);}
        catch(error){
          if(!/rate limit|\b429\b|Internal server error|\b50[234]\b|fetch failed|ECONNRESET|ETIMEDOUT/i.test(error.message)||attempt===5)throw error;
          await delay(1000*(attempt+1));
        }
      }
    };
  }
  if(config){
    assert.equal((await rpc.sendJsonRpc('status',[])).chain_id,'testnet');
    assert.match(config.id,/\.testnet$/);
    const sponsor=new Account(config.id,rpc,config.key);
    for(const [i,identity] of identities.slice(0,2).entries())if(!((i===0 && reuse)||(i===1 && reuse?.agent)))await sponsor.signAndSendTransaction({receiverId:identity.id,
      actions:[actions.createAccount(),actions.transfer(i===0?5n*10n**24n:10n**24n),actions.addFullAccessKey(identity.key.getPublicKey())],waitUntil:'FINAL'});
    const playerAccount=new Account(config.alice.id,rpc,config.alice.key);
    if((await playerAccount.getState()).balance.available < 300_000_000_000_000_000_000_000n) {
      await sponsor.signAndSendTransaction({receiverId:config.alice.id,actions:[actions.transfer(400_000_000_000_000_000_000_000n)],waitUntil:'FINAL'});
    }
    await writeFile(new URL(`../../data/agent-rehearsal-${suffix}.json`,import.meta.url),JSON.stringify({contract:identities[0].id,adminKey:identities[0].key.toString(),agent:identities[1].id,ownerKey:identities[1].key.toString()}),{flag:'wx',mode:0o600});
  }
  const [admin,owner,alice]=identities.map(i=>new Account(i.id,rpc,i.key.toString()));
  const contract=identities[0].id,agent=identities[1].id;
  const gas=100_000_000_000_000n;
  const receipts=[];
  const record=(label,result)=>{
    const success=typeof result.status?.SuccessValue==='string';
    receipts.push({label,hash:result.transaction?.hash,success});
    assert.ok(success,JSON.stringify(result.status));
    return getTransactionLastResult(result);
  };
  const call=async(wallet,methodName,args={})=>record(methodName,await wallet.callFunctionRaw({contractId:contract,methodName,args,gas,deposit:0n,waitUntil:'FINAL'}));
  const view=(method,args={})=>rpc.callFunction({contractId:contract,method,args,blockQuery:{finality:'final'}});
  const wasm=await readFile(new URL('../target/wasm32-unknown-unknown/release/barrel_bay_arena.wasm',import.meta.url));
  const codeHash=baseEncode(createHash('sha256').update(wasm).digest());
  let token,tokenCodeHash;
  if(backedGold && reuse){
    const configuration=await view('gold_config');
    assert.equal(configuration.funder,config.id);
    token=configuration.token;
    const tokenWasm=await readFile(new URL('../../near-gold/target/wasm32-unknown-unknown/release/nearly_afloat_gold.wasm',import.meta.url));
    tokenCodeHash=baseEncode(createHash('sha256').update(tokenWasm).digest());
    assert.equal((await admin.getState()).codeHash,codeHash);
    assert.equal((await rpc.viewAccount({accountId:token,blockQuery:{finality:'final'}})).code_hash,tokenCodeHash);
    for(const player of [agent,identities[2].id])assert.equal(await view('registered',{player}),false,'Resume only a deployment with no funded players');
    assert.deepEqual(await view('pools'),[30000,0]);
    assert.equal(await rpc.callFunction({contractId:token,method:'ft_balance_of',args:{account_id:contract}}),'30000');
    assert.equal(await rpc.callFunction({contractId:token,method:'ft_total_supply',args:{}}),'1000000');
    receipts.push({label:'resumed prefunded GOLD deployment',codeHash,tokenCodeHash});
  }else if(backedGold){
    token=config?'g-'+suffix+'.'+config.id:'gold.'+alice.accountId;
    const tokenKey=KeyPair.fromRandom('ed25519');
    const tokenWasm=await readFile(new URL('../../near-gold/target/wasm32-unknown-unknown/release/nearly_afloat_gold.wasm',import.meta.url));
    tokenCodeHash=baseEncode(createHash('sha256').update(tokenWasm).digest());
    const funder=config?new Account(config.id,rpc,config.key):alice;
    const tokenOwner=new Account(token,rpc,tokenKey.toString());
    record('create GOLD',await funder.signAndSendTransaction({receiverId:token,actions:[
      actions.createAccount(),actions.transfer(2n*10n**24n),actions.addFullAccessKey(tokenKey.getPublicKey()),
      actions.deployContract(tokenWasm),
    ],waitUntil:'FINAL'}));
    record('initialize GOLD',await tokenOwner.callFunctionRaw({contractId:token,methodName:'new',args:{
      treasury:funder.accountId,supply:'1000000',sale_inventory:'100000',yocto_per_cent:'1000000000000000000',
    },gas,deposit:0n,waitUntil:'FINAL'}));
    record('deploy GOLD arena',await admin.signAndSendTransaction({receiverId:contract,actions:[
      actions.deployContract(wasm),actions.functionCall('new_with_gold',{referee:contract,token,funder:funder.accountId},gas,0n),
    ],waitUntil:'FINAL'}));
    const storage=await rpc.callFunction({contractId:token,method:'storage_balance_bounds',args:{}});
    record('register vault',await funder.callFunctionRaw({contractId:token,methodName:'storage_deposit',
      args:{account_id:contract,registration_only:true},gas,deposit:BigInt(storage.min),waitUntil:'FINAL'}));
    record('fund finite reserve',await funder.callFunctionRaw({contractId:token,methodName:'ft_transfer_call',
      args:{receiver_id:contract,amount:'30000',msg:'treasury'},gas,deposit:1n,waitUntil:'FINAL'}));
    assert.equal(await rpc.callFunction({contractId:token,method:'ft_balance_of',args:{account_id:contract}}),'30000');
  }else if(!reuse)record('deploy',await admin.signAndSendTransaction({receiverId:contract,actions:[actions.deployContract(wasm),actions.functionCall('new',{referee:contract},gas,0n)],waitUntil:'FINAL'}));
  for(const player of [agent,identities[2].id])if(!await view('registered',{player}))await call(admin,'grant_test_gold',{player});
  const quote=(await view('collection_quotes')).find(q=>q.discount>0 && q.buy<=1000 && q.count===8);
  assert.ok(quote);
  const args={agent,items:[quote.item],budget:quote.buy,per_trade:quote.buy,expires_at:Date.now()+1800000,enabled:true};
  await call(admin,'configure_agent',args);
  const limited=KeyPair.fromRandom('ed25519');
  await owner.addFunctionCallAccessKey({publicKey:limited.getPublicKey(),contractId:contract,methodNames:['agent_trade'],allowance:250_000_000_000_000_000_000_000n});
  const journalDirectory=await mkdtemp(join(tmpdir(),'afloat-agent-journal-'));
  t.after(()=>rm(journalDirectory,{recursive:true,force:true}));
  const runtimeEnv={AFLOAT_AGENT_ACCOUNT:agent,AFLOAT_AGENT_CONTRACT:contract,AFLOAT_AGENT_KEY:limited.toString(),
    AFLOAT_AGENT_RPC:rpcUrl,AFLOAT_AGENT_JOURNAL:join(journalDirectory,'journal.json')};
  await assert.rejects(loadMerchantAgent({...runtimeEnv,AFLOAT_AGENT_KEY:identities[1].key.toString()}),/only agent_trade/);
  let lostHash;
  const runtime=await loadMerchantAgent(runtimeEnv,{provider:rpc,send:async tx=>{
    throw new Error('Simulated interruption before broadcast');
  }});
  const wallet=new Account(agent,rpc,limited.toString());
  const permission=await rpc.viewAccessKey({accountId:agent,publicKey:limited.getPublicKey().toString(),blockQuery:{finality:'final'}});
  const before=await view('balance',{player:agent});
  await assert.rejects(runtime.tick(),/Simulated interruption before broadcast/);
  assert.equal((await view('agent_policy',{agent})).nonce,0);
  const interrupted=await loadMerchantAgent(runtimeEnv,{provider:rpc,send:async tx=>{
    const result=await rpc.sendTransactionUntil(tx,'FINAL');
    lostHash=result.transaction.hash;
    throw new Error('Simulated lost acknowledgement after confirmed transaction');
  }});
  await assert.rejects(interrupted.tick(),/Simulated lost acknowledgement/);
  const resumed=await loadMerchantAgent(runtimeEnv,{provider:rpc});
  const buy=await resumed.tick();
  assert.equal(buy.action,'buy');assert.equal(buy.hash,lostHash);
  const saved=JSON.parse(await readFile(runtimeEnv.AFLOAT_AGENT_JOURNAL,'utf8'));
  assert.equal(saved.pending,null);
  assert.equal(saved.history.length,1);
  assert.equal(saved.history[0].result.transaction.hash,buy.hash);
  assert.equal(saved.history[0].signed,undefined);
  assert.ok(saved.history[0].before.blockHash);
  assert.equal(await view('balance',{player:agent}),before-quote.buy);
  assert.equal((await resumed.tick()).action,'wait');
  const releaseJournal=await lockAgentFile(runtimeEnv.AFLOAT_AGENT_JOURNAL);
  assert.equal((await resumed.tick()).reason,'Another worker owns this journal');
  await releaseJournal();
  const state=async()=>{
    const block=await rpc.viewBlock({finality:'final'});
    const blockQuery={blockId:block.header.hash};
    const fixed=(method,args)=>rpc.callFunction({contractId:contract,method,args,blockQuery});
    const [balance,policy,collection,storage]=await Promise.all([
      fixed('balance',{player:agent}),fixed('agent_policy',{agent}),fixed('collection',{player:agent}),
      rpc.sendJsonRpc('query',{request_type:'view_state',account_id:contract,prefix_base64:'',block_id:block.header.hash}),
    ]);
    return [balance,policy,collection,storage.values.sort((a,b)=>a.key.localeCompare(b.key))];
  };
  const direct = async (methodName, params, target=contract) => {
    const block=await rpc.viewBlock({finality:'final'});
    const access=await rpc.viewAccessKey({accountId:agent,publicKey:limited.getPublicKey().toString(),blockQuery:{finality:'final'}});
    const tx=createTransaction(agent,limited.getPublicKey(),target,BigInt(access.nonce)+1n,
      [actions.functionCall(methodName,params,gas,0n)],baseDecode(block.header.hash));
    const {signedTransaction}=await new KeyPairSigner(limited).signTransaction(tx);
    return rpc.sendTransactionUntil(signedTransaction,'FINAL');
  };
  const reject=async(label,methodName,params,expected,target=contract)=>{
    const prior=await state();
    let outcome;
    try { outcome=await direct(methodName,params,target); }
    catch(error){
      assert.match(error.message,expected,label+' unexpected failure');
      receipts.push({label,layer:'protocol',reason:error.message.slice(0,500),method:methodName,args:params,
        stateUnchanged:true});
    }
    if (outcome) {
      assert.ok(outcome.status?.Failure,label+' must fail');
      assert.match(JSON.stringify(outcome.status.Failure),expected);
      const snapshot=prior.slice(0,3);
      receipts.push({label,hash:outcome.transaction.hash,success:false,layer:'contract',outcome:outcome.status,
        method:methodName,args:params,before:snapshot,stateUnchanged:true});
    }
    assert.deepEqual(await state(),prior,label+' mutated state');
  };
  const trade={action:'buy',item:quote.item,expected_price:quote.buy,nonce:1};
  await reject('replay','agent_trade',trade,/Agent nonce changed/);
  await reject('budget bypass','agent_trade',{...trade,nonce:2},/Agent budget exceeded/);
  await reject('per-trade limit','agent_trade',{...trade,nonce:2,expected_price:quote.buy+1},/Agent trade limit/);
  await reject('unsupported action','agent_trade',{...trade,nonce:2,action:'withdraw'},/Agent action forbidden/);
  await reject('forbidden item','agent_trade',{...trade,item:'not-permitted',nonce:2},/Agent item forbidden/);
  await reject('self escalation','configure_agent',{...args,budget:10000},/Access key does not allow method configure_agent/ );
  await reject('bypass wrapper','collection_action',{action:'buy',item:quote.item,expected_price:quote.buy},/Access key does not allow method collection_action/);
  await reject('wrong receiver','agent_trade',trade,/ReceiverMismatch|receiver.*does not match/i,identities[2].id);
  if(backedGold){
    await reject('withdraw vault backing','withdraw_gold',{amount:'100'},/Access key does not allow method withdraw_gold/);
    await reject('transfer GOLD tokens','agent_trade',trade,/ReceiverMismatch|receiver.*does not match/i,token);
  }
  // Programmed demand from a separate test wallet consumes four units.
  for(let i=0;i<4;i++){
    const current=(await view('collection_quotes')).find(q=>q.item===quote.item);
    await call(alice,'collection_action',{action:'buy',item:quote.item,expected_price:current.buy});
  }
  const release=await resumed.tick();
  assert.equal(release.action,'sell');assert.ok(release.hash);
  const policy=await view('agent_policy',{agent});
  assert.equal(policy.spent,quote.buy);assert.equal(policy.revenue,release.expected_price);assert.equal(policy.nonce,2);
  assert.equal((await view('collection_quotes')).find(q=>q.item===quote.item).count,4);
  assert.equal(await view('balance',{player:agent}),before-policy.spent+policy.revenue);
  await reject('cumulative budget after resale','agent_trade',{...trade,nonce:3},/Agent budget exceeded/);
  await call(admin,'configure_agent',{...args,enabled:false});
  await reject('revoked policy','agent_trade',{...trade,nonce:3},/Agent policy inactive/);
  const expandedPolicy={...args,budget:quote.buy+1000,per_trade:1000,expires_at:Date.now()+1800000};
  await call(admin,'configure_agent',expandedPolicy);
  const current=(await view('collection_quotes')).find(q=>q.item===quote.item);
  const competing=KeyPair.fromRandom('ed25519');
  await owner.addFunctionCallAccessKey({publicKey:competing.getPublicKey(),contractId:contract,methodNames:['agent_trade'],allowance:250_000_000_000_000_000_000_000n});
  const rivals=[wallet,new Account(agent,rpc,competing.toString())];
  const proposals=await Promise.all(rivals.map(signer=>signer.createSignedTransaction({receiverId:contract,
    actions:[actions.functionCall('agent_trade',{action:'buy',item:quote.item,expected_price:current.buy,nonce:3},gas,0n)]})));
  assert.notEqual(proposals[0].transaction.publicKey.toString(),proposals[1].transaction.publicKey.toString());
  const concurrent=await Promise.all(proposals.map(tx=>rpc.sendTransactionUntil(tx,'FINAL')));
  assert.equal(concurrent.filter(r=>typeof r.status?.SuccessValue==='string').length,1);
  const failure=concurrent.find(r=>r.status?.Failure);
  assert.match(JSON.stringify(failure.status.Failure),/Agent nonce changed/);
  receipts.push(...concurrent.map(r=>({label:'concurrent economic nonce',hash:r.transaction.hash,outcome:r.status})));
  assert.equal((await view('agent_policy',{agent})).nonce,3);
  assert.equal((await view('agent_policy',{agent})).spent,quote.buy+current.buy);
  await call(admin,'configure_agent',{...expandedPolicy,enabled:false});
  const expiry=Date.now()+(config?30000:1500);
  await call(admin,'configure_agent',{...expandedPolicy,expires_at:expiry});
  let expired=false;
  for(let attempt=0;attempt<90;attempt++){
    const block=await rpc.viewBlock({finality:'final'});
    if(Number(block.header.timestamp_nanosec)/1e6>=expiry){expired=true;break;}
    await delay(config?1000:300);
  }
  assert.ok(expired,'The RPC did not advance past the policy expiry');
  await reject('expired policy','agent_trade',{...trade,nonce:4},/Agent policy inactive/);
  const empty=KeyPair.fromRandom('ed25519');
  await owner.addFunctionCallAccessKey({publicKey:empty.getPublicKey(),contractId:contract,methodNames:['agent_trade'],allowance:1n});
  const tinyAccess=await rpc.viewAccessKey({accountId:agent,publicKey:empty.getPublicKey().toString(),blockQuery:{finality:'final'}});
  const tinyBlock=await rpc.viewBlock({finality:'final'});
  const tinyTx=createTransaction(agent,empty.getPublicKey(),contract,BigInt(tinyAccess.nonce)+1n,
    [actions.functionCall('agent_trade',{...trade,nonce:4},gas,0n)],baseDecode(tinyBlock.header.hash));
  const signedTiny=await new KeyPairSigner(empty).signTransaction(tinyTx);
  const beforeAllowance=await state();
  await assert.rejects(rpc.sendTransactionUntil(signedTiny.signedTransaction,'FINAL'),/allowance.*(not enough|insufficient)|does not have enough balance|NotEnoughAllowance/i);
  assert.deepEqual(await state(),beforeAllowance);
  receipts.push({label:'gas allowance exhausted',layer:'protocol',allowance:'1'});
  await owner.deleteKey(limited.getPublicKey());
  await reject('removed key','agent_trade',{...trade,nonce:4},/AccessKey.*does not exist|access key.*does not exist|AccessKeyNotFound/i);
  await assert.rejects(loadMerchantAgent(runtimeEnv),/AccessKey.*does not exist|access key.*does not exist|AccessKeyNotFound/i);
  if (!config && !backedGold) {
    const checkpointPath=join(journalDirectory,'provision.json');
    const parameters={admin,rpc,contract,chain:(await rpc.sendJsonRpc('status',[])).chain_id,
      checkpointPath,items:[quote.item]};
    for(const stage of ['keys-saved','account-created','gold-granted','policy-configured','key-installed']) {
      await assert.rejects(provisionMerchantReserve({...parameters,stopAfter:stage}),new RegExp('interrupted after '+stage));
    }
    const installed=await provisionMerchantReserve(parameters);
    const beforeResume=await rpc.viewAccount({accountId:installed.account,blockQuery:{finality:'final'}});
    const balanceResume=await view('balance',{player:installed.account});
    const repeat=await provisionMerchantReserve(parameters);
    assert.equal(repeat.account,installed.account);
    assert.equal(repeat.ownerKey,installed.ownerKey);
    assert.equal(repeat.receipts.length,4);
    assert.equal(await view('balance',{player:installed.account}),balanceResume);
    assert.deepEqual(await rpc.viewAccount({accountId:installed.account,blockQuery:{finality:'final'}}),beforeResume);
    receipts.push({label:'provisioning recovery',interruptions:5,transactions:repeat.receipts});
  }
  let backing;
  if(backedGold){
    const vault=await rpc.callFunction({contractId:token,method:'ft_balance_of',args:{account_id:contract},blockQuery:{finality:'final'}});
    const supply=await rpc.callFunction({contractId:token,method:'ft_total_supply',args:{},blockQuery:{finality:'final'}});
    const [treasury,botBank]=await view('pools');
    const agentBalance=await view('balance',{player:agent});
    const playerBalance=await view('balance',{player:identities[2].id});
    assert.equal(BigInt(vault),BigInt(treasury+botBank+agentBalance+playerBalance));
    assert.equal(supply,'1000000');
    backing={token,tokenCodeHash,vault,supply,treasury,botBank,agentBalance,playerBalance};
  }
  const evidence={network:config?'testnet':'private-sandbox',agent,contract,codeHash,backing,cost:policy.spent,revenue:policy.revenue,net:policy.revenue-policy.spent,concurrentExecutions:1,permission,receipts,buy,release,lostAcknowledgementRecovered:buy.hash===lostHash};
  if(config)await writeFile(new URL(`../../output/agent-testnet-${suffix}.json`,import.meta.url),JSON.stringify(evidence,(_,value)=>typeof value==='bigint'?value.toString():value,2));
  console.log(JSON.stringify(evidence,(_,value)=>typeof value==='bigint'?value.toString():value));
});
