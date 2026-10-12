// Phone-app sign-in bridge. Served by the frontend canister so Internet
// Identity derives the SAME account as the website. The phone app opens this
// page in the system browser with its own session public key; we ask
// Internet Identity (classic authorize protocol) to delegate to that key and
// hand the delegation back to the app through its URL scheme. The private
// key never leaves the phone.
//
// Fewest taps: the Internet Identity window opens by itself when the browser
// allows it, and the reply returns to the app by itself. Each step falls back
// to one obvious button when the browser insists on a tap.
(function () {
  "use strict";
  // The old identity.internetcomputer.org address redirects to id.ai. Checking
  // messages against the old origin silently discarded every authorization reply.
  var II_URL = "https://id.ai/authorize";
  var II_ORIGIN = new URL(II_URL).origin;
  // Only ever hand delegations to our own app (never an arbitrary URL).
  var APP_SCHEME = "com.igniteclubhq.app";
  var APP_HOST = "ii-callback";
  var ALLOWED_CALLBACK = APP_SCHEME + "://" + APP_HOST;
  var MAX_TTL_NS = BigInt(8 * 24 * 60 * 60) * BigInt(1000000000);
  var IS_ANDROID = /Android/i.test(navigator.userAgent);

  var params = new URLSearchParams(location.hash.slice(1));
  var pk = params.get("pk") || "";
  var nonce = params.get("n") || "";
  var cb = params.get("cb") || "";
  var go = document.getElementById("go");
  var back = document.getElementById("back");
  var msg = document.getElementById("msg");
  var title = document.getElementById("title");
  var popup = null;
  var watchdog = null;
  var timeout = null;
  var finished = false;

  // Android: an intent:// link names our app package, so Chrome hands it
  // straight to the installed app (and offers the Play Store if it's missing)
  // instead of silently ignoring an unknown scheme. Data travels in the query
  // because the intent:// fragment carries the routing instructions.
  function appLink(query) {
    if (IS_ANDROID) {
      return "intent://" + APP_HOST + "?" + query + "#Intent;scheme=" + APP_SCHEME + ";package=" + APP_SCHEME + ";end";
    }
    return ALLOWED_CALLBACK + "?" + query;
  }

  function stopWaiting() {
    clearInterval(watchdog);
    clearTimeout(timeout);
  }

  function showContinue(label) {
    go.textContent = label;
    go.hidden = false;
    go.disabled = false;
  }

  function fail(text) {
    stopWaiting();
    title.textContent = "Sign-in didn't finish";
    msg.textContent = text;
    msg.className = "err";
    showContinue("Try again");
  }

  if (!/^(?:[0-9a-f]{2}){20,100}$/i.test(pk) || !/^[A-Za-z0-9-]{8,64}$/.test(nonce) || cb !== ALLOWED_CALLBACK) {
    fail("Please start sign-in from the Ignite Club HQ app.");
    go.hidden = true;
    return;
  }
  back.href = appLink("n=" + encodeURIComponent(nonce) + "&cancel=1");
  back.hidden = false;

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
  function b64url(str) {
    return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  window.addEventListener("message", function (event) {
    if (finished || event.origin !== II_ORIGIN || !popup || event.source !== popup) return;
    var data = event.data || {};
    if (data.kind === "authorize-ready") {
      popup.postMessage(
        { kind: "authorize-client", sessionPublicKey: hexToBytes(pk), maxTimeToLive: MAX_TTL_NS },
        II_ORIGIN,
      );
    } else if (data.kind === "authorize-client-success") {
      stopWaiting();
      try { popup.close(); } catch (e) { /* ignore */ }
      try {
        var chain = {
          delegations: data.delegations.map(function (d) {
            var del = { expiration: BigInt(d.delegation.expiration).toString(16), pubkey: bytesToHex(d.delegation.pubkey) };
            if (d.delegation.targets && d.delegation.targets.length) {
              del.targets = d.delegation.targets.map(function (t) { return bytesToHex(t._arr || t); });
            }
            return { delegation: del, signature: bytesToHex(d.signature) };
          }),
          publicKey: bytesToHex(data.userPublicKey),
        };
        var href = appLink("n=" + encodeURIComponent(nonce) + "&d=" + b64url(JSON.stringify(chain)));
        finished = true;
        title.textContent = "You're signed in";
        msg.className = "";
        msg.textContent = "Opening Ignite… If nothing happens, tap the button below.";
        go.hidden = true;
        back.href = href;
        back.textContent = "Open Ignite";
        back.className = "btn";
        location.href = href;
      } catch (e) {
        fail("Something went wrong reading the sign-in. Please try again.");
      }
    } else if (data.kind === "authorize-client-failure") {
      stopWaiting();
      try { popup.close(); } catch (e) { /* ignore */ }
      fail(data.text || "Sign-in was cancelled.");
    }
  });

  // auto=true: opened without a tap. Browsers that block that get one button.
  function start(auto) {
    if (finished) return;
    if (popup && !popup.closed) {
      try { popup.focus(); } catch (e) { /* ignore */ }
      return;
    }
    stopWaiting();
    popup = window.open(II_URL, "ii-signin", "width=500,height=720");
    if (!popup) {
      if (auto) {
        msg.className = "";
        msg.textContent = "Tap continue to confirm it's you.";
        showContinue("Continue");
      } else {
        fail("Your browser blocked the sign-in window. Please allow pop-ups and try again.");
      }
      return;
    }
    go.disabled = true;
    msg.className = "";
    msg.textContent = "Confirm it's you in the Internet Identity window…";
    watchdog = setInterval(function () {
      if (popup && popup.closed && !finished) fail("Sign-in was cancelled. You can try again or go back to the app.");
    }, 500);
    timeout = setTimeout(function () {
      try { popup.close(); } catch (e) { /* ignore */ }
      fail("Sign-in took too long. Please try again or go back to the app.");
    }, 5 * 60 * 1000);
  }

  go.addEventListener("click", function () { start(false); });
  back.addEventListener("click", function () {
    stopWaiting();
    try { if (popup && !finished) popup.close(); } catch (e) { /* ignore */ }
  });

  start(true);
})();
