// Phone-app sign-in bridge. Served by the frontend canister so Internet
// Identity derives the SAME account as the website. The phone app opens this
// page in the system browser with its own session public key; we ask
// Internet Identity (classic authorize protocol) to delegate to that key and
// hand the delegation back to the app through its URL scheme. The private
// key never leaves the phone.
(function () {
  "use strict";
  // The old identity.internetcomputer.org address redirects to id.ai. Checking
  // messages against the old origin silently discarded every authorization reply.
  var II_URL = "https://id.ai/authorize";
  var II_ORIGIN = new URL(II_URL).origin;
  // Only ever hand delegations to our own app scheme (never an arbitrary URL).
  var ALLOWED_CALLBACK = "com.igniteclubhq.app://ii-callback";
  var MAX_TTL_NS = BigInt(8 * 24 * 60 * 60) * BigInt(1000000000);

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

  function stopWaiting() {
    clearInterval(watchdog);
    clearTimeout(timeout);
  }

  function fail(text) {
    stopWaiting();
    title.textContent = "Sign-in didn't finish";
    msg.textContent = text;
    msg.className = "err";
    go.textContent = "Try again";
    go.hidden = false;
    go.disabled = false;
  }

  if (!/^(?:[0-9a-f]{2}){20,100}$/i.test(pk) || !/^[A-Za-z0-9-]{8,64}$/.test(nonce) || cb !== ALLOWED_CALLBACK) {
    fail("Please start sign-in from the Ignite Club HQ app.");
    go.hidden = true;
    return;
  }
  go.disabled = false;
  back.href = ALLOWED_CALLBACK + "#n=" + encodeURIComponent(nonce) + "&cancel=1";
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
    if (event.origin !== II_ORIGIN || !popup || event.source !== popup) return;
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
        var href = ALLOWED_CALLBACK + "#n=" + encodeURIComponent(nonce) + "&d=" + b64url(JSON.stringify(chain));
        title.textContent = "You're signed in";
        msg.textContent = "Returning to the app…";
        go.hidden = true;
        back.href = href;
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

  go.addEventListener("click", function () {
    stopWaiting();
    go.disabled = true;
    msg.className = "";
    msg.textContent = "Waiting for you to confirm…";
    popup = window.open(II_URL, "ii-signin", "width=500,height=720");
    if (!popup) {
      fail("Your browser blocked the sign-in window. Please allow pop-ups and try again.");
      return;
    }
    watchdog = setInterval(function () {
      if (popup && popup.closed) fail("Sign-in was cancelled. You can try again or return to the app.");
    }, 500);
    timeout = setTimeout(function () {
      try { popup.close(); } catch (e) { /* ignore */ }
      fail("Sign-in took too long. Please try again or return to the app.");
    }, 5 * 60 * 1000);
  });
  back.addEventListener("click", function () {
    stopWaiting();
    try { if (popup) popup.close(); } catch (e) { /* ignore */ }
  });
})();
