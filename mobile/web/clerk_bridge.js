// Clerk in the browser, for the Flutter web build (lib/clerk_web.dart). Clerk's Frontend API refuses a request that
// carries both Origin and Authorization, and a browser always sends Origin, so the Dart SDK's native mode can't run
// here: the official clerk-js does the talking instead, the same build the web app loads. Every call resolves to a
// JSON string, {"ok": true, ...} or {"ok": false, "error": "…"}, so the Dart side needs no JS types.
(() => {
  const clerk = () => window.Clerk;
  const message = (e) => e?.errors?.[0]?.longMessage || e?.errors?.[0]?.message || e?.message || String(e);
  const run = (fn) => async (...args) => {
    try {
      return JSON.stringify({ ok: true, ...(await fn(...args)) });
    } catch (e) {
      return JSON.stringify({ ok: false, error: message(e) });
    }
  };
  const user = () => {
    const u = clerk()?.user;
    return u ? { email: u.primaryEmailAddress?.emailAddress ?? '', name: [u.firstName, u.lastName].filter(Boolean).join(' ') } : null;
  };
  const needsSecond = (s) => s === 'needs_second_factor' || s === 'needs_client_trust';
  let flow = null; // the sign-in or sign-up waiting for its emailed code

  async function finish(res) {
    if (res.status !== 'complete') {
      flow = res;
      return { status: res.status };
    }
    await clerk().setActive({ session: res.createdSessionId });
    flow = null;
    return { status: 'complete', user: user() };
  }

  window.baywatchClerk = {
    // The publishable key names the Frontend API host: pk_test_<base64 "host$">
    load: run(async (key) => {
      if (!clerk()) {
        const host = atob(key.split('_')[2]).replace(/\$$/, '');
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = `https://${host}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`;
          s.async = true;
          s.crossOrigin = 'anonymous';
          s.dataset.clerkPublishableKey = key;
          s.onload = resolve;
          s.onerror = () => reject(new Error('Sign-in could not be loaded. Check your connection.'));
          document.head.appendChild(s);
        });
      }
      await clerk().load();
      return { user: user() };
    }),
    token: run(async () => ({ token: (await clerk()?.session?.getToken()) ?? null })),
    // A new device is asked for a code by email after the password (Clerk's client trust)
    signInPassword: run(async (identifier, password) => {
      const res = await clerk().client.signIn.create({ identifier, password });
      if (!needsSecond(res.status)) return finish(res);
      flow = await res.prepareSecondFactor({ strategy: 'email_code' });
      return { status: 'code' };
    }),
    sendSignInCode: run(async (identifier) => {
      const res = await clerk().client.signIn.create({ identifier });
      const factor = res.supportedFirstFactors?.find((f) => f.strategy === 'email_code');
      if (!factor) throw new Error('This account can’t sign in with a code.');
      flow = await res.prepareFirstFactor({ strategy: 'email_code', emailAddressId: factor.emailAddressId });
      return { status: 'code' };
    }),
    verifySignIn: run(async (code) => {
      if (!flow) throw new Error('The sign-in expired. Start again.');
      const strategy = { strategy: 'email_code', code };
      return finish(needsSecond(flow.status) ? await flow.attemptSecondFactor(strategy) : await flow.attemptFirstFactor(strategy));
    }),
    signUp: run(async (emailAddress, password) => {
      const res = await clerk().client.signUp.create({ emailAddress, password });
      flow = await res.prepareEmailAddressVerification({ strategy: 'email_code' });
      return { status: 'code' };
    }),
    verifySignUp: run(async (code) => {
      if (!flow) throw new Error('The sign-up expired. Start again.');
      return finish(await flow.attemptEmailAddressVerification({ code }));
    }),
    signOut: run(async () => {
      await clerk()?.signOut();
      flow = null;
      return {};
    }),
  };
})();
