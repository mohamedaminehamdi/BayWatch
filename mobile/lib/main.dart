import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import 'api.dart';
import 'auth.dart';
import 'screens/landing.dart';
import 'shell.dart';
import 'theme.dart';
import 'ui.dart';

void main() {
  runApp(const App());
  session.init();
}

class App extends StatelessWidget {
  const App({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Baywatch',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(),
        home: ListenableBuilder(
          listenable: session,
          builder: (context, _) {
            if (!session.ready) return const _Splash();
            if (session.error != null && !session.signedIn) return _StartError(session.error!);
            // signed out: the landing page, with sign-in and sign-up on top of it (web: app/(marketing))
            return session.signedIn ? const AppShell() : const LandingScreen();
          },
        ),
      );
}

class _Splash extends StatelessWidget {
  const _Splash();
  @override
  Widget build(BuildContext context) => const Scaffold(body: Center(child: Logo()));
}

// The app can't start without the server: it gives the Clerk key and everything else
class _StartError extends StatelessWidget {
  const _StartError(this.message);
  final String message;
  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Logo(),
                  const SizedBox(height: 32),
                  Text('Baywatch can’t start.', style: T.display(44)),
                  const SizedBox(height: 12),
                  ErrorNote(message),
                  const SizedBox(height: 12),
                  Text('This app talks to $apiUrl. Start the web app there (cd web && npm run dev), or run with --dart-define=API_URL=…',
                      style: T.body(15, color: C.muted)),
                  const SizedBox(height: 24),
                  Btn('Try again', icon: LucideIcons.refreshCw, size: BtnSize.lg, onPressed: session.init),
                ]),
              ),
            ),
          ),
        ),
      );
}
