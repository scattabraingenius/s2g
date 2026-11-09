/* Google sign-in and the database for pages other than the main app (capture page, dashboard).

   Same Firebase project, config and SDK version as ../index.html. On the same site and browser
   profile the main app's sign-in is reused automatically (Firebase keeps it in this origin's
   storage), so no second sign-in is needed. The SDK is loaded lazily: a page opened offline from
   the service-worker cache still works and saves locally, and loading is retried when the
   connection comes back. Nothing here ever reads or writes until a user is signed in. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GrindCloud = api;
})(typeof window === "object" ? window : globalThis, function () {
  "use strict";
  const CONFIG = {
    apiKey: "AIzaSyDTcQiFsjhSzlsEl7uPJvTtsxp798XOqIQ",
    authDomain: "family-planner-ccafc.firebaseapp.com",
    databaseURL: "https://family-planner-ccafc-default-rtdb.firebaseio.com",
    projectId: "family-planner-ccafc"
  };
  const NODE = "planners/the-grind-scattabrain-2026";
  const SDK = ["firebase-app-compat.js", "firebase-auth-compat.js", "firebase-database-compat.js"]
    .map(f => "https://www.gstatic.com/firebasejs/9.23.0/" + f);

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.async = false;
      s.onload = resolve; s.onerror = () => { s.remove(); reject(Error("Could not load " + src)); };
      document.head.appendChild(s);
    });
  }

  /* create({onUser(user|null), onConnected(bool), onState(state)}) -> controller.
     state: "loading" | "unavailable" (SDK could not load, e.g. offline) | "ready". */
  function create(handlers = {}) {
    let state = "loading", user = null, authReady = false, started = false, busy = false, error = "";
    const set = s => { state = s; handlers.onState && handlers.onState(s); };
    async function start() {
      if (started) return; started = true;
      try {
        if (!(window.firebase && firebase.database && firebase.auth)) for (const src of SDK) await loadScript(src);
        if (!window.firebase || !firebase.initializeApp) throw Error("Firebase did not load");
        if (!firebase.apps.length) firebase.initializeApp(CONFIG);
        firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
        set("ready");
        firebase.auth().onAuthStateChanged(u => { authReady = true; busy = false; user = u || null; handlers.onUser && handlers.onUser(user); });
        firebase.database().ref(".info/connected").on("value", s => handlers.onConnected && handlers.onConnected(s.val() === true));
      } catch (e) {
        started = false; set("unavailable");
        addEventListener("online", start, { once: true });
      }
    }
    return {
      start,
      get state() { return state; }, get user() { return user; }, get authReady() { return authReady; },
      get busy() { return busy; }, get error() { return error; },
      ref: path => firebase.database().ref(path),
      plannerRef: child => firebase.database().ref(NODE + (child ? "/" + child : "")),
      signIn() {
        if (state !== "ready" || busy) return;
        busy = true; error = "";
        const provider = new firebase.auth.GoogleAuthProvider();
        /* Same fallback as the main app: a blocked popup becomes a full-page redirect. */
        firebase.auth().signInWithPopup(provider).catch(err => {
          const code = (err && err.code) || "";
          if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment" || code === "auth/cancelled-popup-request") {
            return firebase.auth().signInWithRedirect(provider).catch(e2 => { busy = false; error = (e2 && e2.code) || "sign-in failed"; handlers.onUser && handlers.onUser(user); });
          }
          busy = false; error = code === "auth/popup-closed-by-user" ? "" : (code || "sign-in failed");
          handlers.onUser && handlers.onUser(user);
        });
      },
    };
  }
  return { create, NODE, CONFIG };
});
