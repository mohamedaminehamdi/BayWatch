import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import 'auth.dart';
import 'screens/vehicles.dart';
import 'theme.dart';
import 'ui.dart';

const _promises = ['A bay held free until you arrive', 'Checked in by the camera, no card or app tap', 'Your plate is deleted after every session'];

enum _Step { details, code }

/// Sign in or create an account, with the same Clerk accounts as the web app: email and password, or a code by
/// email. web/app/(auth)/layout.tsx and Clerk's `SignIn`/`SignUp` with the brand's appearance.
class SignInScreen extends StatefulWidget {
  const SignInScreen({super.key, this.signUp = false});
  final bool signUp;
  @override
  State<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends State<SignInScreen> {
  late bool _signUp = widget.signUp;
  var _step = _Step.details;
  bool _withCode = false, _busy = false;
  String _error = '';
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _code = TextEditingController();

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _go(Future<void> Function() fn) async {
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      await fn();
      if (!mounted) return;
      if (session.signedIn) {
        // the app shell replaces the landing page underneath; a new driver adds their car first
        final nav = Navigator.of(context);
        nav.popUntil((r) => r.isFirst);
        if (_signUp) nav.push(MaterialPageRoute<void>(builder: (_) => const WelcomeScreen()));
        return;
      }
    } catch (e) {
      _error = '$e';
    }
    if (mounted) setState(() => _busy = false);
  }

  void _submit() {
    if (_step == _Step.code) {
      _go(() => _signUp ? session.verifySignUp(_code.text) : session.verifySignIn(_code.text));
    } else if (_signUp) {
      _go(() async {
        await session.signUp(_email.text, _password.text);
        if (!session.signedIn) setState(() => _step = _Step.code);
      });
    } else if (_withCode) {
      _go(() async {
        await session.sendSignInCode(_email.text);
        if (!session.signedIn) setState(() => _step = _Step.code);
      });
    } else {
      _go(() async {
        if (!await session.signInWithPassword(_email.text, _password.text)) setState(() => _step = _Step.code);
      });
    }
  }

  void _switch() => setState(() {
        _signUp = !_signUp;
        _step = _Step.details;
        _withCode = false;
        _error = '';
      });

  @override
  Widget build(BuildContext context) {
    final code = _step == _Step.code;
    final title = code ? 'Check your email' : _signUp ? 'Create your account' : 'Sign in';
    final subtitle = code
        ? 'We sent a 6-digit code to ${_email.text.trim()}.'
        : _signUp
            ? 'Book your first bay in a minute'
            : 'Welcome back to Baywatch';
    final ready = code ? _code.text.trim().length == 6 : _email.text.contains('@') && (_withCode && !_signUp || _password.text.isNotEmpty);

    return Scaffold(
      appBar: AppBar(backgroundColor: C.page, surfaceTintColor: C.page, title: const Logo(), centerTitle: false, titleSpacing: 0),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Panel(
                  padding: const EdgeInsets.all(24),
                  radius: 24,
                  child: AutofillGroup(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Text(title, style: T.display(40)),
                      const SizedBox(height: 4),
                      Text(subtitle, style: T.body(16, color: C.muted)),
                      const SizedBox(height: 24),
                      if (!code) ...[
                        Field(
                          label: 'Email address',
                          child: TextField(
                            controller: _email,
                            keyboardType: TextInputType.emailAddress,
                            autofillHints: const [AutofillHints.email],
                            autocorrect: false,
                            onChanged: (_) => setState(() {}),
                            onSubmitted: (_) => ready ? _submit() : null,
                            decoration: const InputDecoration(hintText: 'you@example.com'),
                          ),
                        ),
                        if (_signUp || !_withCode) ...[
                          const SizedBox(height: 16),
                          Field(
                            label: 'Password',
                            hint: _signUp ? 'At least 8 characters.' : null,
                            child: TextField(
                              controller: _password,
                              obscureText: true,
                              autofillHints: [_signUp ? AutofillHints.newPassword : AutofillHints.password],
                              onChanged: (_) => setState(() {}),
                              onSubmitted: (_) => ready ? _submit() : null,
                            ),
                          ),
                        ],
                      ] else
                        Field(
                          label: 'Verification code',
                          child: TextField(
                            controller: _code,
                            keyboardType: TextInputType.number,
                            autofillHints: const [AutofillHints.oneTimeCode],
                            maxLength: 6,
                            autofocus: true,
                            textAlign: TextAlign.center,
                            style: T.mono(24, weight: FontWeight.w600, em: 0.4, color: C.ink),
                            onChanged: (_) => setState(() {}),
                            onSubmitted: (_) => ready ? _submit() : null,
                            decoration: const InputDecoration(counterText: '', hintText: '••••••'),
                          ),
                        ),
                      if (_error.isNotEmpty) ...[const SizedBox(height: 16), ErrorNote(_error)],
                      const SizedBox(height: 20),
                      Btn(
                        code ? 'Verify' : _signUp ? 'Continue' : _withCode ? 'Send me a code' : 'Continue',
                        size: BtnSize.lg,
                        expand: true,
                        loading: _busy,
                        onPressed: ready ? _submit : null,
                      ),
                      if (!_signUp && !code) ...[
                        const SizedBox(height: 8),
                        TextButton(
                          onPressed: () => setState(() {
                            _withCode = !_withCode;
                            _error = '';
                          }),
                          child: Text(_withCode ? 'Use your password instead' : 'Email me a code instead', style: T.body(15, weight: FontWeight.w600, color: C.accent)),
                        ),
                      ],
                      if (code)
                        TextButton(
                          onPressed: () => setState(() {
                            _step = _Step.details;
                            _code.clear();
                            _error = '';
                          }),
                          child: Text('Use another email', style: T.body(15, weight: FontWeight.w600, color: C.accent)),
                        ),
                    ]),
                  ),
                ),
                const SizedBox(height: 16),
                Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                  Text(_signUp ? 'Have an account?' : 'No account yet?', style: T.body(15, color: C.muted)),
                  TextButton(onPressed: _switch, child: Text(_signUp ? 'Sign in' : 'Sign up', style: T.body(15, weight: FontWeight.w600, color: C.accent))),
                ]),
                const SizedBox(height: 24),
                for (final p in _promises)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      const Icon(LucideIcons.check, size: 20, color: C.ink),
                      const SizedBox(width: 12),
                      Expanded(child: Text(p, style: T.body(16, color: C.muted))),
                    ]),
                  ),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}
