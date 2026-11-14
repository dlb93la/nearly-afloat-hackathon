// Presentation only: both layouts share the same account, inventory and actions.
export function interfaceLayoutFor({ width, height, coarsePointer = false, finePointer = false, mobileDevice = false }) {
  const compactWindow = width <= 760;
  const touchScreen = mobileDevice || (coarsePointer && !finePointer && Math.min(width, height) <= 1024);
  return compactWindow || touchScreen ? 'mobile' : 'desktop';
}

export function mountInterfaceLayout(view = window, doc = document) {
  const coarse = view.matchMedia('(pointer: coarse)');
  const fine = view.matchMedia('(any-hover: hover) and (any-pointer: fine)');
  let frame = null;
  function apply() {
    frame = null;
    const width = doc.documentElement.clientWidth || view.innerWidth;
    const height = doc.documentElement.clientHeight || view.innerHeight;
    const mobileDevice = view.navigator?.userAgentData?.mobile === true;
    const values = {
      uiLayout: interfaceLayoutFor({ width, height, coarsePointer: coarse.matches, finePointer: fine.matches, mobileDevice }),
      uiOrientation: width > height ? 'landscape' : 'portrait',
      uiInput: mobileDevice || (coarse.matches && !fine.matches) ? 'touch' : 'pointer',
    };
    for (const [key, value] of Object.entries(values)) {
      if (doc.body.dataset[key] !== value) doc.body.dataset[key] = value;
    }
  }
  function schedule() {
    if (frame === null) frame = view.requestAnimationFrame(apply);
  }
  apply();
  view.addEventListener('resize', schedule, { passive: true });
  coarse.addEventListener('change', schedule);
  fine.addEventListener('change', schedule);
  return () => {
    view.removeEventListener('resize', schedule);
    coarse.removeEventListener('change', schedule);
    fine.removeEventListener('change', schedule);
    if (frame !== null) view.cancelAnimationFrame(frame);
  };
}
