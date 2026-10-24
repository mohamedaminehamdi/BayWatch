import 'package:flutter/foundation.dart';

import 'api.dart';
import 'clerk_native.dart' if (dart.library.js_interop) 'clerk_web.dart';

// Optional: by default the key comes from the server (GET /api/config), so the app always signs in to the same
// Clerk instance the server checks tokens against
const _keyOverride = String.fromEnvironment('CLERK_PUBLISHABLE_KEY');

/// Clerk, one way per platform: phones use the Dart SDK (clerk_native.dart); browsers use clerk-js
/// (clerk_web.dart), because Clerk refuses the native mode's Authorization header next to a browser's Origin.
/// Errors are thrown as ApiException with Clerk's own sentence.
abstract interface class ClerkBackend {
  Future<void> init(String publishableKey);
  bool get signedIn;
  String get email;
  String get name;
  Future<String?> token();
  /// Returns whether the driver is signed in already; if not, a code was emailed and [verifySignIn] finishes
  Future<bool> signInWithPassword(String email, String password);
  Future<void> sendSignInCode(String email);
  Future<void> verifySignIn(String code);
  /// Creates the account and emails a code; [verifySignUp] finishes
  Future<void> signUp(String email, String password);
  Future<void> verifySignUp(String code);
  Future<void> signOut();
}

/// The driver's Clerk session (the same accounts as the web app). Signed-in API calls carry its short-lived
/// session token as `Authorization: Bearer`, which the server's `auth()` accepts like the web's cookie.
class Session extends ChangeNotifier {
  final ClerkBackend _clerk = createClerk();
  bool _started = false;
  bool ready = false;
  String? error; // the session couldn't start: no server, or no Clerk key
  bool operator = false; // listed in the server's OPERATOR_EMAILS
  VoiceConfig? voice; // the server's Vapi assistant; null hides the mic

  bool get signedIn => _started && _clerk.signedIn;
  String get email => _clerk.email;
  String get name => _clerk.name;

  Future<void> init() async {
    ready = false;
    error = null;
    notifyListeners();
    try {
      final config = await api.config();
      voice = config.voice;
      final key = _keyOverride.isNotEmpty ? _keyOverride : config.clerkKey;
      if (key == null || key.isEmpty) throw ApiException('The server has no Clerk publishable key set.');
      if (!_started) await _clerk.init(key);
      _started = true;
      await _checkRole();
    } catch (e) {
      error = '$e';
    }
    ready = true;
    notifyListeners();
  }

  Future<String?> token() async => _started ? _clerk.token() : null;

  // The operator tab shows for accounts the server lets into GET /api/operator
  Future<void> _checkRole() async {
    operator = false;
    if (!signedIn) return;
    try {
      await api.get('/api/operator');
      operator = true;
    } catch (_) {}
  }

  Future<T> _run<T>(Future<T> Function() fn) async {
    if (!_started) throw ApiException(error ?? 'Sign-in isn’t ready yet.');
    try {
      return await fn();
    } finally {
      await _checkRole();
      notifyListeners();
    }
  }

  Future<bool> signInWithPassword(String email, String password) => _run(() => _clerk.signInWithPassword(email.trim(), password));
  Future<void> sendSignInCode(String email) => _run(() => _clerk.sendSignInCode(email.trim()));
  Future<void> verifySignIn(String code) => _run(() => _clerk.verifySignIn(code.trim()));
  Future<void> signUp(String email, String password) => _run(() => _clerk.signUp(email.trim(), password));
  Future<void> verifySignUp(String code) => _run(() => _clerk.verifySignUp(code.trim()));
  Future<void> signOut() => _run(_clerk.signOut);
}

final session = Session();
