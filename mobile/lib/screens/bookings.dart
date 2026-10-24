import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../api.dart';
import '../app_state.dart';
import '../format.dart';
import '../theme.dart';
import '../ui.dart';
import 'booking.dart';

// The driver's bookings: credit, the active session, upcoming and past ones with receipts.
// web/components/bookings/bookings.tsx

const _status = <String, Tone>{
  'upcoming': (label: 'Booked', bg: C.brandTint, fg: C.brandStrong),
  'live': (label: 'Live', bg: C.signal, fg: C.ink),
  'completed': (label: 'Completed', bg: C.brandTint, fg: C.brandStrong),
  'cancelled': (label: 'Cancelled', bg: C.sunken, fg: C.muted),
  'no_show': (label: 'No-show', bg: C.warnTint, fg: C.warn),
};
const _active = {'arrived': 'Checked in', 'charging': 'Charging', 'walkup': 'Walk-up'};

Tone _toneOf(String status) => _status[status] ?? (label: status, bg: C.sunken, fg: C.muted);
String _when(ReservationView r) => '${formatDay(r.start)} · ${formatTime(r.start)}–${formatTime(r.end)}';

class BookingsScreen extends StatefulWidget {
  const BookingsScreen({super.key});
  @override
  State<BookingsScreen> createState() => _BookingsScreenState();
}

class _BookingsScreenState extends State<BookingsScreen> {
  BookingsResponse? _data;
  String _error = '', _key = '';
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _key = _viewerKey();
    _load();
    // every 4 s while this tab shows: bookings made elsewhere (by voice, say) show up within 5 s
    _poll = Timer.periodic(const Duration(seconds: 4), (_) {
      if (currentTab.value == AppTab.bookings) _load();
    });
    appState.addListener(_onShell);
    currentTab.addListener(_onTab);
  }

  @override
  void dispose() {
    _poll?.cancel();
    appState.removeListener(_onShell);
    currentTab.removeListener(_onTab);
    super.dispose();
  }

  // the shell's next and active booking: a change (a session just ended, say) reloads at once
  String _viewerKey() {
    final v = appState.state?.viewer;
    return '${v?.active?.id}:${v?.active?.status}:${v?.next?.id}:${v?.next?.status}';
  }

  void _onShell() {
    final k = _viewerKey();
    if (k == _key) return;
    _key = k;
    _load();
  }

  void _onTab() {
    if (currentTab.value == AppTab.bookings) _load();
  }

  Future<void> _load() async {
    try {
      final d = await api.bookings();
      if (mounted) {
        setState(() {
          _data = d;
          _error = '';
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 32, 20, 48),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 720),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text('Bookings', style: T.display(40)),
            if (d != null && (d.creditCents > 0 || d.firstFree)) ...[const SizedBox(height: 24), _Credit(d)],
            if (_error.isNotEmpty) ...[const SizedBox(height: 24), ErrorNote(_error)],
            if (d?.active != null) ...[const SizedBox(height: 24), _ActiveCard(d!.active!)],
            const SizedBox(height: 40),
            const SectionLabel('Upcoming'),
            const SizedBox(height: 12),
            if (d == null && _error.isEmpty) const Skeleton(),
            if (d != null && d.upcoming.isEmpty)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                decoration: BoxDecoration(color: C.sunken, borderRadius: BorderRadius.circular(16)),
                child: Text('Nothing booked. You can book up to 60 days ahead.', style: T.body(14, color: C.muted)),
              ),
            for (final r in d?.upcoming ?? const <ReservationView>[]) ...[_UpcomingRow(r), const SizedBox(height: 12)],
            const SizedBox(height: 28),
            const SectionLabel('Past'),
            const SizedBox(height: 12),
            if (d != null && d.past.isEmpty)
              EmptyState(
                icon: LucideIcons.ticket,
                title: 'No past bookings',
                body: 'Finished, cancelled and missed bookings show up here, each with its receipt.',
                action: Btn('Find a charger', size: BtnSize.lg, onPressed: () => goTab(context, AppTab.explore)),
              ),
            for (final r in d?.past ?? const <ReservationView>[]) ...[_PastRow(key: ValueKey(r.id), r: r), const SizedBox(height: 12)],
          ]),
        ),
      ),
    );
  }
}

class _Credit extends StatelessWidget {
  const _Credit(this.d);
  final BookingsResponse d;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(color: C.brandTint, borderRadius: BorderRadius.circular(16)),
        child: Wrap(spacing: 24, runSpacing: 12, crossAxisAlignment: WrapCrossAlignment.center, children: [
          if (d.creditCents > 0)
            Row(mainAxisSize: MainAxisSize.min, children: [
              const Icon(LucideIcons.wallet, size: 20, color: C.ink),
              const SizedBox(width: 12),
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('CREDIT', style: T.mono(12, em: 0.1, color: C.muted)),
                Text(formatEuro(d.creditCents), style: T.display(32, height: 1)),
              ]),
            ]),
          Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            if (d.firstFree)
              Row(mainAxisSize: MainAxisSize.min, children: [
                const Icon(LucideIcons.gift, size: 16, color: C.ink),
                const SizedBox(width: 8),
                Text('Your first reservation is free.', style: T.body(14, weight: FontWeight.w600)),
              ]),
            if (d.creditCents > 0) Text('Used automatically on your next booking.', style: T.body(14, color: C.muted)),
          ]),
        ]),
      );
}

class _ActiveCard extends StatelessWidget {
  const _ActiveCard(this.r);
  final ReservationView r;
  @override
  Widget build(BuildContext context) => Material(
        color: C.brandDeep,
        borderRadius: BorderRadius.circular(24),
        child: InkWell(
          borderRadius: BorderRadius.circular(24),
          hoverColor: C.brandStrong,
          onTap: () => openBooking(context, r.id),
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Row(children: [
              const LiveDot(color: C.mint, size: 12),
              const SizedBox(width: 16),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${_active[r.status] ?? 'Now'} · until ${formatTime(r.end)}', style: T.body(16, weight: FontWeight.w600, color: C.onBrand)),
                  Text(r.bayName, style: T.body(14, color: C.onBrandMuted)),
                ]),
              ),
              Text('OPEN →', style: T.mono(12, weight: FontWeight.w600, em: 0.1, color: C.signal)),
            ]),
          ),
        ),
      );
}

// A row as the web's: a pill, the bay and its time, and an amount
Widget _rowContent(Tone tone, ReservationView r, int cents, {Widget? trailing}) => Row(children: [
      StatusChip.tone(tone),
      const SizedBox(width: 12),
      Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(r.bayName, maxLines: 1, overflow: TextOverflow.ellipsis, style: T.body(16, weight: FontWeight.w600)),
          Text(_when(r), maxLines: 1, overflow: TextOverflow.ellipsis, style: T.mono(13, em: 0, color: C.muted)),
        ]),
      ),
      const SizedBox(width: 12),
      Text(formatEuro(cents), style: T.mono(15, weight: FontWeight.w600, em: 0, color: C.ink)),
      ?trailing,
    ]);

class _UpcomingRow extends StatelessWidget {
  const _UpcomingRow(this.r);
  final ReservationView r;
  @override
  Widget build(BuildContext context) {
    final tone = r.blockedSince != null ? (label: 'Bay occupied', bg: C.warnTint, fg: C.warn) : _toneOf(r.status);
    return Material(
      color: C.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: const BorderSide(color: C.line)),
      child: InkWell(
        customBorder: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        onTap: () => openBooking(context, r.id),
        child: Padding(padding: const EdgeInsets.all(16), child: _rowContent(tone, r, r.feeCents)),
      ),
    );
  }
}

// A past booking: tap to open its receipt
class _PastRow extends StatefulWidget {
  const _PastRow({super.key, required this.r});
  final ReservationView r;
  @override
  State<_PastRow> createState() => _PastRowState();
}

class _PastRowState extends State<_PastRow> {
  bool _open = false;
  @override
  Widget build(BuildContext context) {
    final r = widget.r;
    final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: BorderSide(color: _open ? C.lineStrong : C.line));
    return Material(
      color: C.surface,
      shape: shape,
      clipBehavior: Clip.antiAlias,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Semantics(
          button: true,
          expanded: _open,
          child: InkWell(
            onTap: () => setState(() => _open = !_open),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: _rowContent(
                _toneOf(r.status),
                r,
                r.totalCents,
                trailing: Padding(
                  padding: const EdgeInsets.only(left: 8),
                  child: AnimatedRotation(
                    turns: _open ? 0.5 : 0,
                    duration: const Duration(milliseconds: 200),
                    child: const Icon(LucideIcons.chevronDown, size: 20, color: C.muted),
                  ),
                ),
              ),
            ),
          ),
        ),
        if (_open)
          Container(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
            decoration: const BoxDecoration(border: Border(top: BorderSide(color: C.line))),
            child: Receipt(charges: r.charges, totalCents: r.totalCents),
          ),
      ]),
    );
  }
}
