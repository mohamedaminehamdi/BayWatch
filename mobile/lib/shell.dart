import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import 'api.dart';
import 'app_state.dart';
import 'auth.dart';
import 'format.dart';
import 'screens/booking.dart';
import 'screens/bookings.dart';
import 'screens/demo_panel.dart';
import 'screens/explore.dart';
import 'screens/operator.dart';
import 'screens/vehicles.dart';
import 'theme.dart';
import 'ui.dart';
import 'voice.dart';

/// The signed-in app: the header (logo, live booking pill, demo, voice, account), the tabs and the bottom
/// navigation. web/app/(app)/layout.tsx and web/components/app/app-nav.tsx
class AppShell extends StatefulWidget {
  const AppShell({super.key});
  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  @override
  void initState() {
    super.initState();
    currentTab.value = AppTab.explore;
    appState.start();
  }

  @override
  void dispose() {
    appState.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: Listenable.merge([currentTab, session]),
        builder: (context, _) {
          final tabs = [AppTab.explore, AppTab.bookings, AppTab.vehicles, if (session.operator) AppTab.operator];
          final tab = tabs.contains(currentTab.value) ? currentTab.value : AppTab.explore;
          return Scaffold(
            body: Column(children: [
              const _Header(),
              // the explore map fills the screen under the header, so the pill row stays off there
              if (tab != AppTab.explore) const _PillRow(),
              Expanded(
                child: IndexedStack(index: tab.index, children: [
                  const ExploreScreen(),
                  const BookingsScreen(),
                  const VehiclesScreen(),
                  session.operator ? const OperatorScreen() : const SizedBox.shrink(),
                ]),
              ),
            ]),
            bottomNavigationBar: _NavBar(tabs: tabs, current: tab),
          );
        },
      );
}

class _Header extends StatelessWidget {
  const _Header();
  @override
  Widget build(BuildContext context) => Container(
        decoration: const BoxDecoration(color: C.page, border: Border(bottom: BorderSide(color: C.line))),
        child: SafeArea(
          bottom: false,
          child: SizedBox(
            height: 56,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(children: [
                Semantics(
                  button: true,
                  label: 'Baywatch, explore',
                  child: GestureDetector(onTap: () => goTab(context, AppTab.explore), child: const ExcludeSemantics(child: Logo())),
                ),
                const Spacer(),
                const DemoButton(),
                const SizedBox(width: 8),
                const MicButton(),
                const SizedBox(width: 8),
                const _Account(),
              ]),
            ),
          ),
        ),
      );
}

// The next or active booking, one tap away from every screen. End times, never a ticking countdown.
class _PillRow extends StatelessWidget {
  const _PillRow();
  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: appState,
        builder: (context, _) {
          final v = appState.state?.viewer;
          final r = v?.active ?? v?.next;
          if (r == null) return const SizedBox.shrink();
          return Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            decoration: const BoxDecoration(color: C.page, border: Border(bottom: BorderSide(color: C.line))),
            child: Center(child: LivePill(r)),
          );
        },
      );
}

class LivePill extends StatelessWidget {
  const LivePill(this.r, {super.key});
  final ReservationView r;

  String _when(int at, int now) => sameDay(at, now) ? formatTime(at) : '${weekdayShort(at)} ${formatTime(at)}';

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now().millisecondsSinceEpoch;
    final warn = r.blockedSince != null;
    final label = warn
        ? 'Bay occupied · see options'
        : r.status == 'charging'
            ? 'Charging until ${formatTime(r.end)}'
            : r.status == 'walkup'
                ? 'Walk-up until ${formatTime(r.end)}'
                : r.status == 'arrived'
                    ? 'Checked in'
                    : r.status == 'live' && now >= r.start
                        ? 'Held until ${formatTime(r.arriveBy)}'
                        : 'Starts ${_when(r.start, now)}';
    final fg = warn ? C.warn : C.brandStrong;
    return Material(
      color: warn ? C.warnTint : C.brandTint,
      shape: StadiumBorder(side: BorderSide(color: (warn ? C.warn : C.brand).withValues(alpha: 0.25))),
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: () => openBooking(context, r.id),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 44),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              LiveDot(color: warn ? C.warn : C.brand),
              const SizedBox(width: 8),
              Flexible(child: Text(label.toUpperCase(), overflow: TextOverflow.ellipsis, style: T.mono(13, weight: FontWeight.w600, color: fg))),
            ]),
          ),
        ),
      ),
    );
  }
}

// Clerk's UserButton: the account, and sign out
class _Account extends StatelessWidget {
  const _Account();
  @override
  Widget build(BuildContext context) {
    final email = session.email;
    final initial = (session.name.isNotEmpty ? session.name : email).characters.firstOrNull?.toUpperCase() ?? '?';
    return PopupMenuButton<String>(
      tooltip: 'Account',
      position: PopupMenuPosition.under,
      color: C.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: const BorderSide(color: C.line)),
      onSelected: (v) async {
        if (v != 'out') return;
        Navigator.of(context).popUntil((r) => r.isFirst);
        await session.signOut();
      },
      itemBuilder: (_) => [
        PopupMenuItem(
          enabled: false,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (session.name.isNotEmpty) Text(session.name, style: T.body(15, weight: FontWeight.w600, color: C.ink)),
            Text(email, style: T.body(14, color: C.muted)),
          ]),
        ),
        const PopupMenuDivider(),
        PopupMenuItem(
          value: 'out',
          child: Row(children: [const Icon(LucideIcons.logOut, size: 18, color: C.ink), const SizedBox(width: 12), Text('Sign out', style: T.body(15))]),
        ),
      ],
      child: CircleAvatar(radius: 18, backgroundColor: C.ink, child: Text(initial, style: T.body(15, weight: FontWeight.w600, color: C.onBrand))),
    );
  }
}

class _NavBar extends StatelessWidget {
  const _NavBar({required this.tabs, required this.current});
  final List<AppTab> tabs;
  final AppTab current;

  static const _items = {
    AppTab.explore: ('Explore', LucideIcons.map),
    AppTab.bookings: ('Bookings', LucideIcons.ticket),
    AppTab.vehicles: ('Vehicles', LucideIcons.carFront),
    AppTab.operator: ('Operator', LucideIcons.gauge),
  };

  @override
  Widget build(BuildContext context) => Container(
        decoration: const BoxDecoration(color: C.page, border: Border(top: BorderSide(color: C.line))),
        child: SafeArea(
          top: false,
          child: Row(children: [
            for (final t in tabs)
              Expanded(
                child: Semantics(
                  selected: t == current,
                  button: true,
                  child: InkWell(
                    onTap: () => goTab(context, t),
                    child: SizedBox(
                      height: 60,
                      child: Stack(children: [
                        // Ecurious's violet line marks the current page
                        if (t == current) Positioned(left: 24, right: 24, top: 0, child: Container(height: 2, color: C.accent)),
                        Center(
                          child: Column(mainAxisSize: MainAxisSize.min, children: [
                            Icon(_items[t]!.$2, size: 22, color: t == current ? C.ink : C.faint),
                            const SizedBox(height: 4),
                            Text(_items[t]!.$1, style: T.body(12, weight: FontWeight.w600, color: t == current ? C.ink : C.faint, height: 1.2)),
                          ]),
                        ),
                      ]),
                    ),
                  ),
                ),
              ),
          ]),
        ),
      );
}
