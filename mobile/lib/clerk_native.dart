import 'dart:async';
import 'dart:convert';

import 'package:clerk_auth/clerk_auth.dart' as clerk;
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'auth.dart';

/// Sign-in on phones through Clerk's Dart SDK in native mode: the client token goes in the Authorization header
ClerkBackend createClerk() => _NativeClerk();

// Clerk's client and token cache, kept across app runs
class _Prefs implements clerk.Persistor {
  SharedPreferences? _p;
  @override
  Future<void> initialize() async => _p = await SharedPreferences.getInstance();
  @override
  void terminate() {}
  @override
  FutureOr<T?> read<T>(String key) {
    final s = _p?.getString('clerk.$key');
    if (s == null) return null;
    return (s.startsWith('s:') ? s.substring(2) : jsonDecode(s.substring(2))) as T?;
  }

  @override
  FutureOr<void> write<T>(String key, T value) => _p?.setString('clerk.$key', value is String ? 's:$value' : 'j:${jsonEncode(value)}');
  @override
  FutureOr<void> delete(String key) => _p?.remove('clerk.$key');
}

class _NativeClerk implements ClerkBackend {
  clerk.Auth? _auth;

  Future<void> _run(Future<void> Function(clerk.Auth a) fn) async {
    final a = _auth;
    if (a == null) throw ApiException('Sign-in isn’t ready yet.');
    try {
      await fn(a);
    } on clerk.ClerkError catch (e) {
      // server errors carry Clerk's own sentence; the SDK wraps it in "{arg} (ERROR RECEIVED FROM SERVER)"
      throw ApiException(e.errors?.errors?.firstOrNull?.longMessage ?? e.argument ?? e.message);
    }
  }

  @override
  Future<void> init(String publishableKey) async {
    final a = clerk.Auth(config: clerk.AuthConfig(publishableKey: publishableKey, persistor: _Prefs()));
    await a.initialize();
    _auth = a;
  }

  @override
  bool get signedIn => _auth?.isSignedIn ?? false;
  @override
  String get email => _auth?.user?.email ?? '';
  @override
  String get name => [_auth?.user?.firstName, _auth?.user?.lastName].whereType<String>().join(' ');

  @override
  Future<String?> token() async {
    final a = _auth;
    if (a == null || !a.isSignedIn) return null;
    try {
      return (await a.sessionToken()).jwt;
    } catch (_) {
      return null;
    }
  }

  // A new device is asked for a code by email after the password (Clerk's client trust)
  @override
  Future<bool> signInWithPassword(String email, String password) async {
    await _run((a) async {
      await a.attemptSignIn(strategy: clerk.Strategy.password, identifier: email.trim(), password: password);
      if (!a.isSignedIn) await a.attemptSignIn(strategy: clerk.Strategy.emailCode);
    });
    return signedIn;
  }

  @override
  Future<void> sendSignInCode(String email) => _run((a) => a.attemptSignIn(strategy: clerk.Strategy.emailCode, identifier: email.trim()));
  @override
  Future<void> verifySignIn(String code) => _run((a) => a.attemptSignIn(strategy: clerk.Strategy.emailCode, code: code.trim()));
  @override
  Future<void> signUp(String email, String password) => _run(
        (a) => a.attemptSignUp(strategy: clerk.Strategy.emailCode, emailAddress: email.trim(), password: password, passwordConfirmation: password),
      );
  @override
  Future<void> verifySignUp(String code) => _run((a) => a.attemptSignUp(strategy: clerk.Strategy.emailCode, code: code.trim()));
  @override
  Future<void> signOut() => _run((a) => a.signOut());
}
