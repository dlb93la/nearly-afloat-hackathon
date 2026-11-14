import './expeditions.css';
import { cosmeticFor } from '../shared/cosmetics.mjs';
import { goldLabel } from './harbor.js';
import { itemThumbnail } from './item-thumbnail.js';
import { selectNearWallet, signNearExpedition, usesNearSocialAccount, requiresGameSessionRenewal } from './near-wallet.js';
import { availableGold, holdGold } from './pending-gold.js';

const OPERATOR_GRACE_MS = 15_000;

const stages = {
  funding: 'Funding the voyage',
  sailing: 'Out at sea',
  auction: 'Auction open',
  settled: 'Auction closed',
  refunded: 'Funding expired',
  unsold: 'Cargo unsold',
};

function remainingTime(deadline, now) {
  if (!deadline) return '';
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1_000));
  if (seconds >= 3_600) return Math.floor(seconds / 3_600) + 'h ' + Math.floor(seconds / 60 % 60) + 'm';
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}

function metric(label, value, essential = false) {
  const cell = document.createElement('div');
  cell.dataset.mobileEssential = String(essential);
  const term = document.createElement('dt');
  const amount = document.createElement('dd');
  term.textContent = label;
  amount.textContent = goldLabel(value);
  cell.append(term, amount);
  return cell;
}

export function createExpeditions(send, connectAccount, inventoryState = () => null) {
  const ids = name => document.getElementById('expeditions' + (name ? '-' + name : ''));
  const panel = ids();
  const gold = ids('gold');
  const cargo = ids('cargo');
  const art = ids('art');
  const item = ids('item');
  const stage = ids('stage');
  const clock = ids('clock');
  const funding = ids('progress-wrap');
  const funded = ids('funded');
  const crew = ids('crew');
  const progress = ids('progress');
  const totals = ids('totals');
  const detail = ids('detail');
  const form = ids('form');
  const amount = ids('amount');
  const action = ids('action');
  const utility = ids('utility');
  const notice = ids('notice');
  const receipt = ids('receipt');
  const modes = ids('modes');
  const dialog = ids('confirm');
  const more = document.createElement('details');
  more.className = 'expedition-more';
  const summary = document.createElement('summary');
  summary.textContent = 'Details';
  const extraTotals = document.createElement('dl');
  extraTotals.className = 'expedition-totals expedition-extra-totals';
  const mobileReceipt = document.createElement('a');
  mobileReceipt.className = 'expedition-receipt expedition-mobile-receipt';
  mobileReceipt.textContent = receipt.textContent;
  mobileReceipt.target = '_blank';
  mobileReceipt.rel = 'noopener';
  const compactStatus = document.createElement('p');
  compactStatus.className = 'expedition-compact-status';
  detail.before(more);
  more.append(summary, detail, extraTotals, mobileReceipt);
  form.before(compactStatus);
  let detailsMobile = null;
  let mobileDetailsOpen = false;
  function syncDetailsLayout() {
    const mobile = document.body.dataset.uiLayout === 'mobile';
    if (mobile === detailsMobile) return;
    if (detailsMobile) mobileDetailsOpen = more.open;
    detailsMobile = mobile;
    more.open = mobile ? mobileDetailsOpen : true;
  }
  more.addEventListener('toggle', () => {
    if (detailsMobile) mobileDetailsOpen = more.open;
  });
  if (window.MutationObserver) new window.MutationObserver(syncDetailsLayout)
    .observe(document.body, { attributes: true, attributeFilter: ['data-ui-layout'] });
  syncDetailsLayout();

  let local = null;
  let localGold = null;
  let chain = null;
  let contract = null;
  let unified = false;
  let account = null;
  let authenticatedAccount;
  let authenticatedGold = null;
  let renewalRequired = false;
  let mode = 'local';
  let online = false;
  let connecting = false;
  let artType;
  let approved;
  let pending;
  let utilityAction;
  let feedback;
  let viewProblem;
  let transactionHash;
  let awaitingChain;
  let releaseGold;
  let autoAdvanceKey = null;
  let autoAdvanceFailed = false;
  let readNotBefore = 0;

  function requestChainView() {
    if (Date.now() < readNotBefore) return false;
    return send({ type: 'expedition-chain-view', ...(transactionHash ? { transactionHash } : {}) });
  }

  const campaign = () => mode === 'near' ? chain?.campaign : local;
  const deadlineOf = current => {
    if (current?.status === 'funding') return current.fundingEndsAt;
    if (current?.status === 'sailing') return current.arrivalAt;
    if (current?.status === 'auction') return current.auctionEndsAt;
    return null;
  };

  function renderClock() {
    clock.textContent = remainingTime(deadlineOf(campaign()), Date.now());
  }

  function setFeedback(message, error = false) {
    feedback = message && { message, error };
    render();
  }

  function render() {
    if (panel.hidden) return;
    syncDetailsLayout();
    const current = campaign();
    panel.dataset.voyageStage = current?.status ?? 'loading';
    let compactText = '';
    const onChain = mode === 'near';
    const accountPending = unified && Boolean(authenticatedAccount) && account !== authenticatedAccount;
    const confirmedBalance = onChain ? (accountPending ? null : chain?.gold) ?? authenticatedGold : localGold;
    const balance = confirmedBalance == null ? null : availableGold(account, confirmedBalance);
    gold.textContent = balance == null ? '—' : goldLabel(balance);
    notice.hidden = !feedback && !(onChain && viewProblem);
    notice.textContent = feedback?.message ?? (onChain ? viewProblem : '') ?? '';
    notice.dataset.error = String(feedback ? feedback.error : Boolean(onChain && viewProblem));
    const receiptHash = chain?.settlementHash || transactionHash;
    const publicReceipt = chain?.receiptNetwork === 'testnet' && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(receiptHash ?? '');
    receipt.hidden = !(onChain && publicReceipt);
    if (!receipt.hidden) receipt.href = 'https://testnet.nearblocks.io/txns/' + encodeURIComponent(receiptHash);
    else receipt.removeAttribute('href');
    mobileReceipt.hidden = receipt.hidden;
    if (!receipt.hidden) mobileReceipt.href = receipt.href;
    else mobileReceipt.removeAttribute('href');
    summary.textContent = current ? `Details · ${current.feePercent}% fee` : 'Details';
    cargo.hidden = !current;
    funding.hidden = current?.status !== 'funding';
    totals.hidden = true;
    extraTotals.hidden = true;
    form.hidden = true;
    utility.hidden = true;
    utilityAction = null;

    const expired = deadlineOf(current) && deadlineOf(current) <= Date.now();
    if (onChain && !renewalRequired && (accountPending || (viewProblem && authenticatedAccount))) {
      utilityAction = 'refresh';
      utility.textContent = 'Refresh voyage';
      detail.textContent = viewProblem ? 'Voyage data is temporarily unavailable. Retrying in the background.'
        : 'Your account is connected. Loading its voyage…';
      compactText = viewProblem ? 'Retrying the voyage update…' : 'Loading your voyage…';
    } else if (onChain && (!account || renewalRequired)) {
      utilityAction = 'connect';
      utility.textContent = renewalRequired ? 'Continue playing' : 'Join the crew';
      detail.textContent = renewalRequired ? 'Renew your game session, then review your action again.' : unified ? 'Sign in once to fund voyages and bid on treasure.'
        : 'Expedition test gold has its own balance and no withdrawal.';
      compactText = renewalRequired ? 'Renew your game session.' : 'Join the crew to fund and bid.';
    } else if (onChain && current?.needsAdvance) {
      const waitingForOperator = chain.managedFinalization && Date.now() - deadlineOf(current) < OPERATOR_GRACE_MS;
      const automatic = waitingForOperator || (!chain.managedFinalization && unified && usesNearSocialAccount(account) && !autoAdvanceFailed);
      utilityAction = automatic ? 'automatic-result' : 'advance';
      utility.textContent = current.status === 'funding' ? 'Return contributions' : 'Show result';
      detail.textContent = automatic ? 'Finalizing the voyage…'
        : current.status === 'funding' ? 'Funding ended below the target. Contributions are ready to return.'
          : 'The auction ended. The result is ready.';
      compactText = automatic ? 'Finalizing the voyage…' : 'The result is ready.';
    } else if (!current) {
      detail.textContent = online ? 'Checking the voyage…' : 'Reconnecting to the bay…';
      compactText = detail.textContent;
    }

    if (current) {
      if (artType !== current.itemType) {
        const cosmetic = cosmeticFor(current.itemType);
        artType = current.itemType;
        art.replaceChildren(...(cosmetic ? [itemThumbnail(cosmetic)] : []));
        item.textContent = cosmetic?.label ?? 'Expedition cargo';
      }
      stage.textContent = stages[current.status] ?? '';
      renderClock();
      const metrics = [];
      if (current.myContribution) metrics.push(metric('You funded', current.myContribution));
      if (current.status === 'funding') {
        funded.textContent = goldLabel(current.funded) + ' / ' + goldLabel(current.target) + ' gold';
        crew.textContent = current.supporters + ' / ' + current.minSupporters + ' crew';
        progress.max = current.target;
        progress.value = current.funded;
      }
      if (current.status === 'auction') {
        metrics.push(metric(current.highestBid ? 'Highest bid' : 'Opening bid', current.highestBid || current.nextBid, true));
        if (current.isHighestBidder) metrics.push(metric('Your reserved bid', current.highestBid));
        else if (current.highestBid) metrics.push(metric('Next bid', current.nextBid));
      }
      if (current.status === 'settled') {
        metrics.push(metric('Winning bid', current.sale.price, true), metric('Crew proceeds', current.sale.distributed));
        if (current.myContribution) metrics.push(metric('Your payout', current.myPayout, true));
        if (!utilityAction && !renewalRequired && onChain && current.won && unified) {
          utilityAction = 'equip-award';
          utility.textContent = chain.awardEquipped ? 'Unequip treasure' : 'Equip treasure';
        } else if (!utilityAction && !renewalRequired && onChain && current.won && !chain.claimed) {
          utilityAction = 'claim';
          utility.textContent = 'Claim in Your Cottage';
        }
      }
      if (current.status === 'refunded' && current.myRefund) metrics.push(metric('Gold returned', current.myRefund, true));
      totals.hidden = !metrics.length;
      const secondary = metrics.filter(cell => cell.dataset.mobileEssential !== 'true');
      extraTotals.replaceChildren(...secondary.map(cell => cell.cloneNode(true)));
      extraTotals.hidden = !secondary.length;
      totals.replaceChildren(...metrics);

      if (!utilityAction || utilityAction === 'claim' || utilityAction === 'equip-award') {
        const details = {
          funding: 'Fund this cargo with the crew. Supporters split the sale after a ' + current.feePercent + '% fee. Miss the target and your gold returns.',
          sailing: 'The crew funded the voyage. Bidding opens when the ship docks.',
          auction: current.isHighestBidder ? 'You lead. Your gold is reserved until the auction closes or someone outbids you.'
            : 'The highest bid wins. Gold reserved for a bid is released when it is outbid.',
          settled: current.won ? (unified ? (chain.awardEquipped ? 'Equipped in ' : 'Ready to equip in ')
            + (cosmeticFor(current.itemType)?.slot === 'pet' ? 'Your Cottage → Gear.' : 'Your Cottage → Decor.')
            : onChain && !chain.claimed ? 'You won the cargo.' : 'You won. Equip your cargo in Your Cottage.')
            : 'The cargo went to the highest bidder. The crew split the proceeds.',
          refunded: 'The voyage missed its target. All contributions were returned.',
          unsold: 'The voyage ended without a bid. The cargo earned no gold.',
        };
        detail.textContent = details[current.status] ?? '';
        compactText = current.status === 'sailing' ? 'Bidding opens when the ship docks.'
          : current.status === 'auction' && current.isHighestBidder ? 'You lead · gold reserved.'
            : current.status === 'settled' ? current.won ? (chain?.awardEquipped ? 'Treasure equipped.' : 'Your treasure is ready.')
              : 'Voyage complete · next cargo coming soon.'
              : current.status === 'refunded' ? 'Voyage closed · contributions returned.'
                : current.status === 'unsold' ? 'Voyage closed · no winning bid.' : '';
      }
      if (onChain && account && !chain.registered && !utilityAction) {
        detail.textContent = 'Your starting balance is being prepared.';
        compactText = 'Preparing your starting gold…';
      }

      const contributing = current.status === 'funding';
      const bidding = current.status === 'auction' && !current.isHighestBidder;
      if (!utilityAction && (!onChain || chain.registered) && (contributing || bidding) && !expired) {
        const min = Math.max(1, contributing ? current.minimumContribution : current.nextBid);
        const max = Math.min(balance ?? 0, contributing ? current.maxContribution : Infinity);
        amount.min = String(min / 100);
        amount.max = String(max / 100);
        amount.placeholder = goldLabel(min) + '+';
        amount.setAttribute('aria-label', contributing ? 'Contribution in test gold' : 'Bid in test gold');
        form.hidden = false;
        action.textContent = contributing ? 'Fund voyage' : 'Place bid';
        amount.disabled = action.disabled = Boolean(pending) || !online || (onChain && Boolean(viewProblem || awaitingChain)) || max < min;
        if (max < min) {
          detail.textContent = contributing && !current.maxContribution && current.supporters < current.minSupporters
            ? 'Another crew member can finish funding the voyage.' : 'Your balance cannot cover the minimum amount.';
          compactText = detail.textContent;
        }
      }
    }
    compactStatus.textContent = compactText;
    compactStatus.hidden = !compactText;
    utility.hidden = !utilityAction || utilityAction === 'automatic-result';
    utility.disabled = Boolean(pending || awaitingChain || connecting) || !online
      || (utilityAction === 'refresh' && Date.now() < readNotBefore);
  }

  function sendRequest(type, data = {}) {
    const actionId = crypto.randomUUID();
    if (!send({ type, actionId, ...data })) {
      setFeedback('Reconnect to the bay and try again.', true);
      return;
    }
    pending = actionId;
    setFeedback('');
  }

  async function sign(method, args) {
    if (['contribute', 'bid', 'advance'].includes(method)) args = { ...args, campaign_id: chain?.campaign?.campaignId ?? chain?.campaign?.fundingEndsAt ?? 0 };
    const social = usesNearSocialAccount(account);
    const cost = method === 'contribute' || method === 'bid' ? args.amount : 0;
    if (social && cost > 0) {
      releaseGold = holdGold(account, chain?.gold, cost);
      if (!releaseGold) { setFeedback('Check your available gold or wait for your current action.', true); return; }
    }
    const request = crypto.randomUUID();
    pending = request;
    transactionHash = null;
    setFeedback(social ? (cost > 0 ? `−${goldLabel(cost)} GOLD · Confirmation pending` : 'Saving your change…') : 'Confirming your action…');
    try {
      const hash = await signNearExpedition(contract, account, method, args);
      if (pending !== request) return;
      transactionHash = hash ?? null;
      awaitingChain = { method, args, expires: Date.now() + 15_000 };
      if (!releaseGold) setFeedback('Transaction sent. Checking final confirmation…');
    } catch (error) {
      if (pending !== request) return;
      if (method === 'advance') autoAdvanceFailed = true;
      if (requiresGameSessionRenewal(error) || error.declined) {
        releaseGold?.(); releaseGold = null;
        awaitingChain = null;
      } else awaitingChain = { method, args, expires: Date.now() + 15_000 };
      if (requiresGameSessionRenewal(error)) {
        renewalRequired = true;
        connectAccount({ renew: true });
      }
      setFeedback(usesNearSocialAccount(account) ? error.message : 'The action was not confirmed. Check the updated balance before retrying.', true);
    } finally {
      if (pending === request) {
        pending = null;
        requestChainView();
        render();
      }
    }
  }

  function finalizeDueVoyage() {
    if (!unified || !online || pending || awaitingChain || renewalRequired || !account || !usesNearSocialAccount(account)
        || chain?.managedFinalization || !chain?.campaign?.needsAdvance) return;
    const current = chain.campaign;
    const key = [current.id, current.status, current.fundingEndsAt, current.auctionEndsAt].join('/');
    if (autoAdvanceKey === key) return;
    autoAdvanceKey = key;
    autoAdvanceFailed = false;
    // The contract only resolves a deadline already reached. It cannot cancel a live funded voyage.
    // This spends no player gold and uses the already-authorized, limited game session.
    void sign('advance', {});
  }

  function clampContributionInput() {
    if (campaign()?.status !== 'funding') return;
    const value = Math.round(amount.valueAsNumber * 100);
    const max = Math.round(Number(amount.max) * 100);
    if (amount.max !== '' && Number.isSafeInteger(value) && Number.isSafeInteger(max) && max >= 0 && value > max) {
      amount.value = String(max / 100);
      setFeedback(`Contribution adjusted to ${goldLabel(max)} GOLD.`);
    }
  }
  amount.addEventListener('input', clampContributionInput);
  amount.addEventListener('change', clampContributionInput);
  // Clamp before validity checks; native max validation otherwise prevents submit from firing.
  form.noValidate = true;
  form.addEventListener('submit', event => {
    event.preventDefault();
    const current = campaign();
    clampContributionInput();
    if (!form.checkValidity()) { form.reportValidity?.(); return; }
    if (!current || pending || !online) return;
    const value = Math.round(amount.valueAsNumber * 100);
    if (!Number.isSafeInteger(value)) return;
    const type = current.status === 'funding' ? 'contribute' : 'bid';
    approved = { type, amount: value, id: current.id, mode, nonce: chain?.nonce };
    dialog.returnValue = '';
    ids('confirm-title').textContent = (type === 'contribute' ? 'Fund voyage' : 'Place bid') + ' · ' + goldLabel(value);
    ids('confirm-detail').textContent = type === 'contribute'
      ? 'Once the ship sails, your contribution pays for the voyage. Your payout depends on the sale.'
      : 'This bid reserves test gold. If you win, the gold pays for the cargo.';
    const copies = mode === 'near' ? current.myOwnedUnits ?? inventoryState()?.ownedCounts?.[current.itemType] ?? 0 : 0;
    if (type === 'bid' && copies > 0) ids('confirm-detail').textContent += ' You already own ' + copies + '. This voyage awards another copy, not a different treasure.';
    dialog.showModal();
  });

  dialog.addEventListener('close', () => {
    const choice = approved;
    approved = null;
    if (dialog.returnValue !== 'confirm' || !choice || pending || campaign()?.id !== choice.id || mode !== choice.mode) return;
    if (choice.type === 'advance') {
      if (campaign()?.needsAdvance) void sign('advance', {});
      return;
    }
    const current = campaign();
    if (choice.amount > Math.round(Number(amount.max) * 100)
        || (deadlineOf(current) && deadlineOf(current) <= Date.now())
        || (choice.type === 'contribute' && current.status !== 'funding')
        || (choice.type === 'bid' && (current.status !== 'auction' || choice.amount < current.nextBid))) {
      clampContributionInput();
      setFeedback('The offer changed. Review the updated amount before confirming.', true);
      return;
    }
    amount.value = '';
    if (mode === 'local') sendRequest('expedition-' + choice.type, { campaignId: choice.id, amount: choice.amount });
    else void sign(choice.type, choice.type === 'contribute'
      ? { amount: choice.amount, nonce: choice.nonce + 1 } : { amount: choice.amount });
  });

  utility.addEventListener('click', async () => {
    if (pending || connecting || !online) return;
    if (utilityAction === 'refresh') requestChainView();
    else if (utilityAction === 'claim') sendRequest('expedition-chain-claim');
    else if (utilityAction === 'equip-award') void sign('equip_voyage_award', { equipped: !chain.awardEquipped, item: campaign()?.itemType });
    else if (utilityAction === 'advance') {
      approved = { type: 'advance', id: campaign().id, mode };
      dialog.returnValue = '';
      ids('confirm-title').textContent = campaign().status === 'funding' ? 'Return contributions?' : 'Show auction result?';
      ids('confirm-detail').textContent = campaign().status === 'funding'
        ? 'The funding deadline passed without meeting the target. Every contribution returns in full.'
        : 'The bidding deadline passed. The highest bid wins, and proceeds are distributed to the crew.';
      dialog.showModal();
    }
    else if (utilityAction === 'connect') {
      if (unified) {
        try {
          // Keep popup creation within the user's click, before awaiting its result.
          const opened = connectAccount(renewalRequired ? { renew: true } : undefined);
          if (await opened === false) setFeedback('Sign-in is not ready. Reconnect to the bay and try again.', true);
        } catch {
          setFeedback('Could not open sign-in. Try again.', true);
        }
        // A social-login failure must never fall through to a different wallet flow.
        return;
      }
      const request = crypto.randomUUID();
      pending = request;
      setFeedback('Connecting your account…');
      try {
        const selected = await selectNearWallet();
        if (pending !== request) return;
        if (!send({ type: 'expedition-chain-challenge', actionId: request, account: selected })) throw new Error('Disconnected');
      } catch {
        if (pending !== request) return;
        pending = null;
        setFeedback('Could not connect your account.', true);
      }
    }
  });

  for (const button of modes.querySelectorAll('button')) {
    button.addEventListener('click', () => {
      if (pending || awaitingChain || dialog.open) return;
      mode = button.dataset.expeditionMode;
      amount.value = '';
      for (const tab of modes.querySelectorAll('button')) tab.setAttribute('aria-pressed', String(tab === button));
      if (mode === 'near') requestChainView();
      setFeedback('');
    });
  }

  window.setInterval(() => {
    if (panel.hidden) return;
    const deadline = deadlineOf(campaign());
    if (deadline && deadline <= Date.now() && !form.hidden) render();
    else renderClock();
  }, 250);
  window.setInterval(() => {
    if ((!panel.hidden || awaitingChain) && mode === 'near' && online) requestChainView();
  }, 5_000);

  return {
    isBusy: () => Boolean(pending || awaitingChain || dialog.open),
    sessionRestored() {
      renewalRequired = false;
      autoAdvanceFailed = false;
      autoAdvanceKey = null;
      render();
    },
    update(wallet, connected, visible, connectionBusy = false, signedInAccount, sessionNeedsRenewal, signedInGold) {
      connecting = connectionBusy;
      if (signedInAccount !== undefined) {
        authenticatedAccount = signedInAccount;
        authenticatedGold = Number.isSafeInteger(signedInGold) && signedInGold >= 0 ? signedInGold : null;
        if (unified && account && account !== signedInAccount) {
          account = null;
          chain = null;
          viewProblem = null;
        }
      }
      if (sessionNeedsRenewal !== undefined) renewalRequired = Boolean(sessionNeedsRenewal);
      local = wallet?.expeditions ?? null;
      localGold = wallet?.gold ?? null;
      const newlyVisible = panel.hidden && visible;
      panel.hidden = !visible;
      if (!connected && online) {
        account = null;
        chain = null;
        if (!pending && !awaitingChain) feedback = null;
        viewProblem = null;
        autoAdvanceKey = null;
        autoAdvanceFailed = false;
      }
      online = connected;
      if (!visible && dialog.open) dialog.close('cancel');
      if (mode === 'near' && online && newlyVisible) requestChainView();
      render();
    },
    scene: campaign,
    setContract(value, sharedGold) {
      contract = value;
      unified = Boolean(contract && sharedGold);
      modes.hidden = !contract || unified;
      if (unified) mode = 'near';
      else if (!contract) mode = 'local';
    },
    async challenge(message, signChallenge) {
      if (pending !== message.actionId) return;
      try {
        const signed = await signChallenge(message.account, message);
        if (pending !== message.actionId) return;
        if (signed.accountId !== message.account || !send({ ...signed, type: 'expedition-chain-auth', actionId: message.actionId })) throw new Error('Disconnected');
      } catch {
        if (pending !== message.actionId) return;
        pending = null;
        setFeedback('Sign-in was not confirmed.', true);
      }
    },
    setChain(message) {
      // A public/previous-account response can finish after sign-in. Keep the
      // authenticated identity; the next poll will read its current state.
      if (unified && authenticatedAccount !== undefined && message.account !== authenticatedAccount) return;
      if (message.campaign && message.campaign.campaignId == null) message = { ...message, campaign: { ...message.campaign, id: message.campaign.id + '/' + message.campaign.fundingEndsAt } };
      account = message.account;
      chain = message;
      viewProblem = null;
      if (awaitingChain) {
        const { method, args, expires } = awaitingChain;
        const { campaign: current } = message;
        const sameCampaign = args.campaign_id == null || args.campaign_id === (current?.campaignId ?? current?.fundingEndsAt);
        const receiptMatches = Boolean(transactionHash && message.transactionHash === transactionHash);
        const confirmed = (receiptMatches && message.transactionStatus === 'finalized') || (!transactionHash && sameCampaign && current && (method === 'contribute' ? message.nonce >= args.nonce
          : method === 'equip_voyage_award' ? message.awardEquipped === args.equipped
            : method === 'advance' ? ['settled', 'refunded', 'unsold'].includes(current.status)
            : current.highestBid >= args.amount && (current.isHighestBidder || current.won)));
        const declined = receiptMatches && message.transactionStatus === 'failed';
        if (confirmed || declined || (!transactionHash && (!sameCampaign || Date.now() >= expires))) {
          awaitingChain = null;
          releaseGold?.(); releaseGold = null;
          if (!confirmed && method === 'advance') autoAdvanceFailed = true;
          if (confirmed) feedback = { message: 'Saved.', error: false };
          else feedback = { message: declined ? 'Transaction declined. Your gold is available again.' : 'Confirmation is still pending. Review your balance or transaction before retrying.', error: true };
        }
      }
      finalizeDueVoyage();
      render();
    },
    viewError(message, retryAfterMs) {
      if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
        readNotBefore = Math.max(readNotBefore, Date.now() + Math.min(120_000, retryAfterMs));
      }
      viewProblem = message;
      if (!transactionHash && awaitingChain?.expires <= Date.now()) {
        if (awaitingChain.method === 'advance') autoAdvanceFailed = true;
        awaitingChain = null;
        releaseGold?.(); releaseGold = null;
        feedback = null;
      }
      render();
    },
    result(message) {
      if (pending !== message.actionId) return;
      pending = null;
      setFeedback(message.message, !message.ok);
    },
  };
}
