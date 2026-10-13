// Phone-app sign-in bridge. Served by the frontend canister so Internet
// Identity derives the SAME account as the website. The phone app opens this
// page in the system browser with its own session public key; we ask
// Internet Identity to delegate to that key and hand the delegation back to
// the app through its URL scheme. The private key never leaves the phone.
//
// No pop-up windows: the page itself goes to Internet Identity and comes back
// (ICRC-167 URL transport, the same one the website uses on phones). Pop-ups
// opened from a Custom Tab were blocked or landed in a separate tab, and the
// reply never made it back to the app. The return address must be listed in
// /.well-known/ii-auth-callbacks (scripts/prepare-canister-dist.mjs).
//
// The classic pop-up protocol stays only as a tap-to-start fallback for an
// Internet Identity that cannot answer the redirect request.
(function () {
  "use strict";
  var II_URL = "https://id.ai/authorize";
  var II_ORIGIN = new URL(II_URL).origin;
  // Only ever hand delegations to our own app (never an arbitrary URL).
  var APP_SCHEME = "com.igniteclubhq.app";
  var APP_HOST = "ii-callback";
  var ALLOWED_CALLBACK = APP_SCHEME + "://" + APP_HOST;
  var MAX_TTL_NS = BigInt(8 * 24 * 60 * 60) * BigInt(1000000000);
  var IS_ANDROID = /Android/i.test(navigator.userAgent);
  var STORE_PREFIX = "ignite_native_ii_flow:";
  var FLOW_MAX_AGE_MS = 10 * 60 * 1000;
  var USER_REJECTED = 3001;

  var navigate = window.__igniteBridgeNavigate || function (url) { location.replace(url); };
  var openApp = window.__igniteBridgeOpenApp || function (url) { location.href = url; };

  var go = document.getElementById("go");
  var back = document.getElementById("back");
  var msg = document.getElementById("msg");
  var title = document.getElementById("title");
  var finished = false;

  function appLink(query) {
    // Android: an intent:// link names our app package, so Chrome hands it
    // straight to the installed app instead of ignoring an unknown scheme.
    if (IS_ANDROID) {
      return "intent://" + APP_HOST + "?" + query + "#Intent;scheme=" + APP_SCHEME + ";package=" + APP_SCHEME + ";end";
    }
    return ALLOWED_CALLBACK + "?" + query;
  }

  function say(text, isError) {
    msg.textContent = text;
    msg.className = isError ? "err" : "";
  }

  function showGo(label, onClick) {
    go.textContent = label;
    go.hidden = false;
    go.disabled = false;
    go.onclick = onClick;
  }

  function showBack(nonce) {
    back.href = appLink("n=" + encodeURIComponent(nonce) + "&cancel=1");
    back.textContent = "Cancel and go back to the app";
    back.className = "secondary";
    back.hidden = false;
  }

  function hexToBytes(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  function toBytes(v) {
    if (v instanceof Uint8Array) return v;
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    if (Array.isArray(v)) return new Uint8Array(v);
    throw new Error("bad bytes");
  }
  function bytesToHex(v) {
    var b = toBytes(v), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  function bytesToB64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function b64ToBytes(str) {
    var bin = atob(str), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function b64url(str) {
    return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  // Principal text (base32 with CRC) -> raw principal bytes, for target lists.
  function principalTextToHex(text) {
    var alphabet = "abcdefghijklmnopqrstuvwxyz234567";
    var clean = String(text).replace(/-/g, "").toLowerCase();
    var bits = 0, value = 0, out = [];
    for (var i = 0; i < clean.length; i++) {
      var idx = alphabet.indexOf(clean[i]);
      if (idx < 0) throw new Error("bad principal");
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) { bits -= 8; out.push((value >>> bits) & 0xff); }
    }
    return bytesToHex(out.slice(4));
  }

  function handBack(nonce, chain) {
    var href = appLink("n=" + encodeURIComponent(nonce) + "&d=" + b64url(JSON.stringify(chain)));
    finished = true;
    title.textContent = "You're signed in";
    say("Opening Ignite… If nothing happens, tap the button below.");
    go.hidden = true;
    back.href = href;
    back.textContent = "Open Ignite";
    back.className = "btn";
    back.hidden = false;
    openApp(href);
  }

  function fail(text, retry) {
    title.textContent = "Sign-in didn't finish";
    say(text, true);
    if (retry) showGo("Try again", retry); else go.hidden = true;
  }

  // ---- Redirect flow (default, no pop-ups) ---------------------------------

  function startRedirect(pk, nonce) {
    var state = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
    var request = {
      jsonrpc: "2.0",
      id: state,
      method: "icrc34_delegation",
      params: { publicKey: bytesToB64(hexToBytes(pk)), maxTimeToLive: MAX_TTL_NS.toString() },
    };
    try {
      sessionStorage.setItem(STORE_PREFIX + state, JSON.stringify({ pk: pk, n: nonce, at: Date.now() }));
    } catch (e) {
      // No storage (private mode quirks): the pop-up fallback still works with a tap.
      startPopupFallback(pk, nonce);
      return;
    }
    var fragment = new URLSearchParams({
      message: JSON.stringify(request),
      callback: location.origin + location.pathname,
      state: state,
    });
    say("Opening Internet Identity…");
    navigate(II_URL + "#" + fragment.toString());
  }

  function finishRedirect(params) {
    var state = params.get("state") || "";
    // Never leave a delegation in history or the referrer.
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* ignore */ }
    var saved = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(STORE_PREFIX + state) || "null");
      sessionStorage.removeItem(STORE_PREFIX + state);
    } catch (e) { saved = null; }
    if (!saved || !saved.pk || !saved.n || Date.now() - saved.at > FLOW_MAX_AGE_MS) {
      fail("This sign-in has expired. Please start again from the Ignite app.");
      return;
    }
    showBack(saved.n);
    var parsed;
    try { parsed = JSON.parse(params.get("message") || ""); } catch (e) { parsed = null; }
    var response = Array.isArray(parsed) ? parsed[0] : parsed;
    var retry = function () { startRedirect(saved.pk, saved.n); };
    if (!response || typeof response !== "object") {
      fail("Something went wrong reading the sign-in. Please try again.", retry);
      return;
    }
    if (response.error) {
      if (response.error.code === USER_REJECTED) {
        fail("Sign-in was cancelled. You can try again or go back to the app.", retry);
      } else {
        // Internet Identity couldn't answer this request: one tap starts the
        // classic window flow instead (a tap is allowed to open a window).
        title.textContent = "One more step";
        say("Tap continue to confirm it's you.");
        showGo("Continue", function () { startPopup(saved.pk, saved.n, false); });
      }
      return;
    }
    try {
      var r = response.result || {};
      var chain = {
        delegations: r.signerDelegation.map(function (d) {
          if (!/^[0-9]{1,20}$/.test(String(d.delegation.expiration))) throw new Error("bad expiration");
          var del = {
            expiration: BigInt(d.delegation.expiration).toString(16),
            pubkey: bytesToHex(b64ToBytes(d.delegation.pubkey)),
          };
          if (d.delegation.targets && d.delegation.targets.length) {
            del.targets = d.delegation.targets.map(principalTextToHex);
          }
          return { delegation: del, signature: bytesToHex(b64ToBytes(d.signature)) };
        }),
        publicKey: bytesToHex(b64ToBytes(r.publicKey)),
      };
      if (!chain.delegations.length) throw new Error("empty chain");
      // The last link must delegate to the phone's own key, nothing else.
      var lastKey = chain.delegations[chain.delegations.length - 1].delegation.pubkey;
      if (lastKey.toLowerCase() !== saved.pk.toLowerCase()) throw new Error("wrong key");
      handBack(saved.n, chain);
    } catch (e) {
      fail("Something went wrong reading the sign-in. Please try again.", retry);
    }
  }

  // ---- Pop-up fallback (only after a tap) ----------------------------------

  var popup = null, watchdog = null, timeout = null, popupKey = null;

  function stopWaiting() { clearInterval(watchdog); clearTimeout(timeout); }

  window.addEventListener("message", function (event) {
    if (finished || !popupKey || event.origin !== II_ORIGIN || !popup || event.source !== popup) return;
    var data = event.data || {};
    if (data.kind === "authorize-ready") {
      popup.postMessage({ kind: "authorize-client", sessionPublicKey: hexToBytes(popupKey.pk), maxTimeToLive: MAX_TTL_NS }, II_ORIGIN);
    } else if (data.kind === "authorize-client-success") {
      stopWaiting();
      try { popup.close(); } catch (e) { /* ignore */ }
      try {
        handBack(popupKey.n, {
          delegations: data.delegations.map(function (d) {
            var del = { expiration: BigInt(d.delegation.expiration).toString(16), pubkey: bytesToHex(d.delegation.pubkey) };
            if (d.delegation.targets && d.delegation.targets.length) {
              del.targets = d.delegation.targets.map(function (t) { return bytesToHex(t._arr || t); });
            }
            return { delegation: del, signature: bytesToHex(d.signature) };
          }),
          publicKey: bytesToHex(data.userPublicKey),
        });
      } catch (e) {
        fail("Something went wrong reading the sign-in. Please try again.", function () { startPopup(popupKey.pk, popupKey.n, false); });
      }
    } else if (data.kind === "authorize-client-failure") {
      stopWaiting();
      try { popup.close(); } catch (e) { /* ignore */ }
      fail(data.text || "Sign-in was cancelled.", function () { startPopup(popupKey.pk, popupKey.n, false); });
    }
  });

  function startPopupFallback(pk, nonce) {
    title.textContent = "One more step";
    say("Tap continue to confirm it's you.");
    showGo("Continue", function () { startPopup(pk, nonce, false); });
  }

  function startPopup(pk, nonce) {
    if (finished) return;
    popupKey = { pk: pk, n: nonce };
    if (popup && !popup.closed) { try { popup.focus(); } catch (e) { /* ignore */ } return; }
    stopWaiting();
    popup = window.open(II_URL, "ii-signin", "width=500,height=720");
    if (!popup) {
      fail("Your browser blocked the sign-in window. Please allow pop-ups and try again.", function () { startPopup(pk, nonce); });
      return;
    }
    go.disabled = true;
    say("Confirm it's you in the Internet Identity window…");
    watchdog = setInterval(function () {
      if (popup && popup.closed && !finished) { stopWaiting(); fail("Sign-in was cancelled. You can try again or go back to the app.", function () { startPopup(pk, nonce); }); }
    }, 500);
    timeout = setTimeout(function () {
      try { popup.close(); } catch (e) { /* ignore */ }
      fail("Sign-in took too long. Please try again or go back to the app.", function () { startPopup(pk, nonce); });
    }, 5 * 60 * 1000);
  }

  back.addEventListener("click", function () {
    stopWaiting();
    try { if (popup && !finished) popup.close(); } catch (e) { /* ignore */ }
  });

  // ---- Entry ---------------------------------------------------------------

  var params = new URLSearchParams(location.hash.slice(1));
  if (params.has("message") && params.has("state")) {
    finishRedirect(params);
    return;
  }
  var pk = params.get("pk") || "";
  var nonce = params.get("n") || "";
  var cb = params.get("cb") || "";
  if (!/^(?:[0-9a-f]{2}){20,100}$/i.test(pk) || !/^[A-Za-z0-9-]{8,64}$/.test(nonce) || cb !== ALLOWED_CALLBACK) {
    fail("Please start sign-in from the Ignite Club HQ app.");
    return;
  }
  showBack(nonce);
  startRedirect(pk, nonce);
})();
