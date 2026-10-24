import 'dart:async';

import 'package:flutter/widgets.dart';

import 'api.dart';

/// One poll of /api/state for the whole app shell, every 2 s while the app is in the foreground
/// (web/components/app/app-state.tsx)
class AppState extends ChangeNotifier with WidgetsBindingObserver {
  StateResponse? state;
  String error = '';
  Timer? _timer;
  bool _foreground = true;

  void start() {
    if (_timer != null) return;
    WidgetsBinding.instance.addObserver(this);
    refresh();
    _timer = Timer.periodic(const Duration(seconds: 2), (_) => refresh());
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
    WidgetsBinding.instance.removeObserver(this);
    state = null;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (_foreground) refresh();
  }

  Future<void> refresh() async {
    if (!_foreground) return;
    try {
      state = await api.state();
      error = '';
    } catch (e) {
      error = '$e';
    }
    notifyListeners();
  }
}

final appState = AppState();

// The app's tabs. Screens switch tabs with goTab, which also closes any screen pushed on top.
enum AppTab { explore, bookings, vehicles, operator }

final currentTab = ValueNotifier(AppTab.explore);

void goTab(BuildContext context, AppTab tab) {
  Navigator.of(context).popUntil((r) => r.isFirst);
  currentTab.value = tab;
}

/// Rebuilds every second, for countdowns (web/components/time.ts useNow)
class NowBuilder extends StatefulWidget {
  const NowBuilder({super.key, required this.builder});
  final Widget Function(BuildContext context, int now) builder;
  @override
  State<NowBuilder> createState() => _NowBuilderState();
}

class _NowBuilderState extends State<NowBuilder> {
  late final Timer _t = Timer.periodic(const Duration(seconds: 1), (_) => setState(() {}));
  @override
  void dispose() {
    _t.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.builder(context, DateTime.now().millisecondsSinceEpoch);
}
