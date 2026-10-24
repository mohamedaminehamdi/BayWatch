import 'dart:convert';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'api.dart';
import 'auth.dart';

/// Sign-in in the browser through clerk-js (web/clerk_bridge.js): the session lives in Clerk's own browser storage
ClerkBackend createClerk() => _WebClerk();

class _WebClerk implements ClerkBackend {
  Map<String, dynamic>? _user;

  Future<Map<String, dynamic>> _call(String fn, [List<String> args = const []]) async {
    final bridge = globalContext.getProperty<JSObject?>('baywatchClerk'.toJS);
    if (bridge == null) throw ApiException('Sign-in isn’t available: web/clerk_bridge.js didn’t load.');
    final result = await bridge.callMethodVarArgs<JSPromise<JSString>>(fn.toJS, [for (final a in args) a.toJS]).toDart;
    final r = jsonDecode(result.toDart) as Map<String, dynamic>;
    if (r['ok'] != true) throw ApiException(r['error'] as String? ?? 'Sign-in failed');
    if (r.containsKey('user')) _user = r['user'] as Map<String, dynamic>?;
    return r;
  }

  bool _done(Map<String, dynamic> r) => r['status'] == 'complete';

  @override
  Future<void> init(String publishableKey) => _call('load', [publishableKey]);
  @override
  bool get signedIn => _user != null;
  @override
  String get email => _user?['email'] as String? ?? '';
  @override
  String get name => _user?['name'] as String? ?? '';
  @override
  Future<String?> token() async => signedIn ? (await _call('token'))['token'] as String? : null;
  @override
  Future<bool> signInWithPassword(String email, String password) async => _done(await _call('signInPassword', [email, password]));
  @override
  Future<void> sendSignInCode(String email) => _call('sendSignInCode', [email]);
  @override
  Future<void> verifySignIn(String code) => _call('verifySignIn', [code]);
  @override
  Future<void> signUp(String email, String password) => _call('signUp', [email, password]);
  @override
  Future<void> verifySignUp(String code) => _call('verifySignUp', [code]);
  @override
  Future<void> signOut() async {
    await _call('signOut');
    _user = null;
  }
}
