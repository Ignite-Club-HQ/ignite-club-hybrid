export function permitsLocalRequest(input, origin) {
  try {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, origin);
    const base = new URL(origin);
    const isAllowedPath = /^\/icp\/api\/(?:v2|v3|v4)\//.test(url.pathname);
    return url.origin === base.origin && ['http:', 'https:'].includes(base.protocol) && ['http:', 'https:'].includes(url.protocol) && isAllowedPath && !url.username && !url.password && !url.hash;
  } catch { return false; }
}
export function installNetworkGuard() {
  const deny = () => { throw new Error('Network operation disabled in isolated lab'); };
  const request = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (!permitsLocalRequest(input, location.origin)) return Promise.reject(new Error('Only the local ICP proxy is allowed'));
    return request(input, { ...init, credentials: 'omit', redirect: 'error' });
  };
  window.XMLHttpRequest = class { constructor() { deny(); } };
  window.EventSource = class { constructor() { deny(); } };
  window.Worker = class { constructor() { deny(); } };
  window.SharedWorker = class { constructor() { deny(); } };
  window.open = deny;
  if (navigator.sendBeacon) navigator.sendBeacon = () => false;
  const Socket = window.WebSocket;
  window.WebSocket = class extends Socket {
    constructor(url, protocols) {
      const target = new URL(url, location.href);
      if (target.host !== location.host || !['ws:', 'wss:'].includes(target.protocol)) deny();
      super(url, protocols);
    }
  };
  document.addEventListener('click', event => {
    const anchor = event.target instanceof Element ? event.target.closest('a') : null;
    if (anchor) event.preventDefault();
  }, true);
  document.addEventListener('submit', event => event.preventDefault(), true);
}
