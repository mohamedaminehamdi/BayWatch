import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../api.dart';
import '../app_state.dart';
import '../format.dart';
import '../theme.dart';
import '../ui.dart';
import '../voice.dart';
import 'booking_flow.dart';
import 'demo_panel.dart';

// One booking, live: from booked to done, with every state the server can put it in.
// web/components/booking/booking-view.tsx and status-stepper.tsx. The browser notifications (ReminderNotification,
// NotifyMe) aren't ported: the reminder shows as a banner on this screen.

Future<void> openBooking(BuildContext context, String id) =>
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => BookingScreen(key: ValueKey(id), id: id)));

// "Today", or "Sat 24 Oct"
String _day(int at, int now) => sameDay(at, now) ? 'Today' : formatDay(at);

// 1:05:09 or 5:09, for time past the slot's end
String _elapsed(int ms) {
  final s = (ms / 1000).floor().clamp(0, 1 << 31);
  final h = s ~/ 3600, m = (s % 3600) ~/ 60;
  final ss = (s % 60).toString().padLeft(2, '0');
  return h > 0 ? '$h:${m.toString().padLeft(2, '0')}:$ss' : '$m:$ss';
}

// What cancelling costs right now, as a share of the fee (the step of the schedule we're in)
int _cancelPercent(ReservationView r, int now) {
  var p = 0;
  for (final s in r.cancelSchedule) {
    if (s.from <= now) p = s.percent;
  }
  return p;
}

String _reminder(String key, ReservationView r, int now) => switch (key) {
      'day_before' => 'Tomorrow at ${formatTime(r.start)}: ${r.bayName}. Cancelling now costs ${_cancelPercent(r, now)}% of the fee.',
      'live' => 'Your booking is live: the bay is held for you from ${formatTime(r.start)}. Cancelling now costs ${_cancelPercent(r, now)}%.',
      'five_before' => 'Starts in 5 minutes. Cancelling now costs ${_cancelPercent(r, now)}%.',
      'five_left' => '5 minutes left in your slot. It ends at ${formatTime(r.end)}.',
      'slot_over' => 'Your slot is over. You have ${idleGraceMs ~/ minute} free minutes to leave, until ${formatTime(r.end + idleGraceMs)}.',
      'idle_fee' => 'Idle fee now: ${formatEuro(idleCentsPerMin)} a minute, up to ${formatEuro(overstayCapCents)}. Please move the car.',
      _ => '',
    };

class BookingScreen extends StatefulWidget {
  const BookingScreen({super.key, required this.id});
  final String id;
  @override
  State<BookingScreen> createState() => _BookingScreenState();
}

class _BookingScreenState extends State<BookingScreen> {
  ReservationView? _r;
  Bay? _bay;
  String _missing = '', _error = '';
  String? _busy;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _load();
    // poll while the booking is still moving; the server changes states on its own (live, no-show, blocked)
    _poll = Timer.periodic(const Duration(seconds: 3), (_) {
      if (mounted && (ModalRoute.of(context)?.isCurrent ?? true)) _load();
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final r = await api.reservation(widget.id);
      if (!mounted) return;
      setState(() => _r = r);
      if (_bay?.id != r.bayId) {
        api.bay(r.bayId).then((b) => mounted ? setState(() => _bay = b) : null, onError: (_) {});
      }
    } catch (e) {
      if (mounted) setState(() => _missing = '$e');
    }
  }

  // Runs an action on the booking, then reloads it and the shell. Returns the error, if any.
  Future<String?> _act(String key, Future<void> Function() fn) async {
    setState(() {
      _busy = key;
      _error = '';
    });
    String? err;
    try {
      await fn();
      await Future.wait([_load(), appState.refresh()]);
    } catch (e) {
      err = '$e';
    }
    if (mounted) {
      setState(() {
        _busy = null;
        if (err != null) _error = err;
      });
    }
    return err;
  }

  Future<void> _post(String action, [Map<String, Object?>? body]) => api.act(widget.id, action, body);

  Future<void> _checkIn() async {
    setState(() {
      _busy = 'checkin';
      _error = '';
    });
    final Point at;
    try {
      at = await locate();
    } catch (_) {
      if (mounted) {
        setState(() {
          _busy = null;
          _error = 'Allow location access so we can confirm you’re at the bay.';
        });
      }
      return;
    }
    await _act('checkin', () => _post('checkin', {'lat': at.lat, 'lng': at.lng}));
  }

  void _openCancel(ReservationView r) => showSheet<void>(
        context,
        title: 'Cancel this booking?',
        builder: (_) => _CancelSheet(r: r, onConfirm: () => _act('cancel', () => _post('cancel'))),
      );

  void _openOtherCar() => showSheet<void>(
        context,
        title: 'Driving a different car?',
        builder: (_) => _OtherCarSheet(onSubmit: (body) => _act('plate', () => _post('plate', body))),
      );

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          backgroundColor: C.page,
          surfaceTintColor: C.page,
          titleSpacing: 0,
          title: const Logo(),
          shape: const Border(bottom: BorderSide(color: C.line)),
          // the web keeps the app header here: the demo controls and the mic stay one tap away
          actions: const [DemoButton(), SizedBox(width: 8), MicButton(), SizedBox(width: 16)],
        ),
        body: SafeArea(
          top: false,
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 24, 20, 40),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 672),
                child: NowBuilder(builder: (context, now) => _body(now)),
              ),
            ),
          ),
        ),
      );

  Widget _body(int now) {
    final r = _r;
    if (r == null && _missing.isNotEmpty) {
      return EmptyState(
        icon: LucideIcons.mapPin,
        title: 'Booking not found',
        body: _missing,
        action: Btn('All bookings', size: BtnSize.lg, onPressed: () => goTab(context, AppTab.bookings)),
      );
    }
    if (r == null) return const Skeleton(height: 384, radius: 24);

    final ended = r.ended;
    final blocked = r.blockedSince != null;
    final canChangeCar = (r.status == 'upcoming' || r.status == 'live') && !blocked;
    final reminder = r.sentReminders.isEmpty ? null : r.sentReminders.last;
    final bay = _bay;

    final Widget state = blocked && !ended
        ? _Blocked(r: r, from: bay?.point, busy: _busy, onCancel: () => _act('cancel', () => _post('cancel')), onBookInstead: (b) => showBookingFlow(context, b))
        : switch (r.status) {
            'upcoming' => _Upcoming(r: r, now: now),
            'live' => _Live(r: r, now: now, busy: _busy, onCheckIn: _checkIn),
            'arrived' => _Arrived(r: r, busy: _busy, onCharge: () => _act('charge', () => _post('charge'))),
            'charging' || 'walkup' => _Session(r: r, now: now, busy: _busy, onFinish: () => _act('finish', () => _post('finish'))),
            _ => _Done(r: r),
          };

    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Wrap(
        spacing: 12,
        runSpacing: 12,
        alignment: WrapAlignment.spaceBetween,
        crossAxisAlignment: WrapCrossAlignment.end,
        children: [
          Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text((r.status == 'walkup' ? 'Walk-up session' : 'Your booking').toUpperCase(), style: T.mono(12, em: 0.12, color: C.muted)),
            const SizedBox(height: 4),
            Text(r.bayName, style: T.display(40)),
            const SizedBox(height: 4),
            Text(
              '${_day(r.start, now)} · ${formatTime(r.start)}–${formatTime(r.end)} · ${duration(r.end - r.start)}'.toUpperCase(),
              style: T.mono(14, em: 0.06, color: C.muted),
            ),
          ]),
          if (!ended && bay != null)
            Btn('Navigate by car', variant: BtnVariant.secondary, icon: LucideIcons.navigation, onPressed: () => openUrl(directionsUrl(bay.point))),
        ],
      ),
      const SizedBox(height: 16),
      // bw-1 and bw-2 are real locks: say so, since the booking really moves the barrier
      if (r.guard == 'hardware' && !ended)
        Row(children: [
          const Icon(LucideIcons.construction, size: 20, color: C.accent),
          const SizedBox(width: 10),
          Expanded(
            child: Text.rich(TextSpan(children: [
              TextSpan(text: 'This raises the real barrier at the bay.', style: T.body(16, weight: FontWeight.w600)),
              if ((r.status == 'upcoming' || r.status == 'live') && r.blockedSince == null) TextSpan(text: ' ${barrierNote(r.start, now)}', style: T.body(16)),
            ])),
          ),
        ])
      else if (r.guard != 'hardware')
        Align(
          alignment: Alignment.centerLeft,
          child: StatusChip(
            hardwareNote(r.guard, r.real),
            bg: C.accentTint,
            fg: C.accent,
            leading: const Icon(LucideIcons.flaskConical, size: 14, color: C.accent),
          ),
        ),
      if (r.status != 'cancelled' && r.status != 'no_show' && r.status != 'walkup') ...[const SizedBox(height: 24), _StatusStepper(r.status)],
      const SizedBox(height: 24),
      if (reminder != null && !ended) ...[
        Note.text(
          _reminder(reminder.key, r, now),
          tone: const {'idle_fee', 'slot_over', 'five_before'}.contains(reminder.key) ? NoteTone.warn : NoteTone.info,
          icon: LucideIcons.bellRing,
        ),
        const SizedBox(height: 16),
      ],
      state,
      if (!ended && !blocked) ...[const SizedBox(height: 16), _Facts(r: r, now: now)],
      if (!ended && (canChangeCar || (r.cancelNowCents != null && !blocked))) ...[
        const SizedBox(height: 16),
        if (canChangeCar) Btn('Different car today', variant: BtnVariant.secondary, size: BtnSize.lg, icon: LucideIcons.carFront, onPressed: _openOtherCar),
        if (canChangeCar && r.cancelNowCents != null && !blocked) const SizedBox(height: 12),
        if (r.cancelNowCents != null && !blocked)
          Btn('Cancel booking', variant: BtnVariant.ghost, size: BtnSize.lg, icon: LucideIcons.x, onPressed: () => _openCancel(r)),
      ],
      if (_error.isNotEmpty) ...[const SizedBox(height: 16), ErrorNote(_error)],
    ]);
  }
}

const _steps = ['Booked', 'Live', 'Checked in', 'Charging', 'Done'];
const _stepIndex = {'upcoming': 0, 'live': 1, 'arrived': 2, 'charging': 3, 'completed': 4};

class _StatusStepper extends StatelessWidget {
  const _StatusStepper(this.status);
  final String status;
  @override
  Widget build(BuildContext context) {
    final at = _stepIndex[status] ?? 0;
    return Semantics(
      label: 'Booking progress: ${_steps[at]}',
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        for (var i = 0; i < _steps.length; i++) ...[
          if (i > 0) const SizedBox(width: 8),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              AnimatedContainer(
                duration: const Duration(milliseconds: 500),
                height: 6,
                decoration: BoxDecoration(color: i <= at ? C.brand : C.line, borderRadius: BorderRadius.circular(99)),
              ),
              const SizedBox(height: 8),
              Text(_steps[i], style: T.body(12.5, weight: FontWeight.w600, color: i == at ? C.ink : i < at ? C.muted : C.faint, height: 1.2)),
            ]),
          ),
        ],
      ]),
    );
  }
}

// The ink card of a live state: lime marks on blue-black, paper text
class _InkCard extends StatelessWidget {
  const _InkCard({required this.children});
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(color: C.brandDeep, borderRadius: BorderRadius.circular(24)),
        child: DefaultTextStyle.merge(
          style: const TextStyle(color: C.onBrand),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children),
        ),
      );
}

Widget _bigClock(String text, {Color color = C.signal}) =>
    FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: Text(text, style: T.display(96, color: color, height: 0.85)));

// The session's times and money, on every live booking screen
class _Facts extends StatelessWidget {
  const _Facts({required this.r, required this.now});
  final ReservationView r;
  final int now;
  @override
  Widget build(BuildContext context) {
    final rows = <(String, String)>[
      ('Session', '${formatTime(r.start)}–${formatTime(r.end)} · ${duration(r.end - r.start)}'),
      if (r.status == 'upcoming' || r.status == 'live') ('Arrive by', formatTime(r.arriveBy)),
      ('Leave by', '${formatTime(r.end + idleGraceMs)}, then ${formatEuro(idleCentsPerMin)}/min (max ${formatEuro(overstayCapCents)})'),
      if (r.status != 'walkup')
        ('Fee', '${formatEuro(r.feeCents)} · ${r.demand.toLowerCase()} demand${r.creditUsedCents > 0 ? ' · ${formatEuro(r.creditUsedCents)} credit used' : ''}'),
      if (r.cancelNowCents != null)
        ('Cancelling now', r.cancelNowCents == 0 ? 'free' : 'costs ${formatEuro(r.cancelNowCents!)} (${_cancelPercent(r, now)}%)'),
      if (r.bookedVia != null) ('Booked via', r.bookedVia!),
    ];
    return Panel(
      padding: const EdgeInsets.all(24),
      child: LayoutBuilder(builder: (context, c) {
        final w = c.maxWidth >= 480 ? (c.maxWidth - 24) / 2 : c.maxWidth;
        return Wrap(spacing: 24, runSpacing: 12, children: [
          for (final (k, v) in rows)
            SizedBox(
              width: w,
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(k.toUpperCase(), style: T.mono(12, em: 0.1, color: C.muted)),
                const SizedBox(height: 2),
                Text(v, style: T.body(16, weight: FontWeight.w600)),
              ]),
            ),
        ]);
      }),
    );
  }
}

class _Plate extends StatelessWidget {
  const _Plate({required this.r, this.onDark = false});
  final ReservationView r;
  final bool onDark;
  @override
  Widget build(BuildContext context) {
    final label = r.vehicleLabel ?? '';
    final hint = r.plateHint ?? '';
    final extra = r.extraPlateHint ?? '';
    if (label.isEmpty && hint.isEmpty && extra.isEmpty) return const SizedBox.shrink();
    final soft = onDark ? C.onBrandMuted : C.muted;
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(top: 24),
      padding: const EdgeInsets.only(top: 20),
      decoration: BoxDecoration(border: Border(top: BorderSide(color: onDark ? Colors.white.withValues(alpha: 0.14) : C.line))),
      child: Wrap(spacing: 12, runSpacing: 10, crossAxisAlignment: WrapCrossAlignment.center, children: [
        Icon(LucideIcons.carFront, size: 20, color: soft),
        if (label.isNotEmpty) Text(label, style: T.body(16, weight: FontWeight.w600, color: onDark ? C.onBrand : C.ink)),
        if (hint.isNotEmpty) PlateBadge(hint, size: PlateSize.sm),
        if (extra.isNotEmpty)
          Row(mainAxisSize: MainAxisSize.min, children: [
            Text('and today', style: T.body(14, color: soft)),
            const SizedBox(width: 8),
            PlateBadge(extra, size: PlateSize.sm),
          ]),
      ]),
    );
  }
}

class _Upcoming extends StatelessWidget {
  const _Upcoming({required this.r, required this.now});
  final ReservationView r;
  final int now;
  @override
  Widget build(BuildContext context) {
    final today = sameDay(r.start, now);
    return Panel(
      padding: const EdgeInsets.all(24),
      radius: 24,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const StatusChip('Booked', bg: C.brandTint, fg: C.brandStrong),
        const SizedBox(height: 16),
        Text('Starts ${today ? 'today' : _day(r.start, now)} at'.toUpperCase(), style: T.mono(14, color: C.muted)),
        const SizedBox(height: 4),
        _bigClock(formatTime(r.start), color: C.ink),
        const SizedBox(height: 12),
        Text(
          'In ${duration(r.start - now)}. It goes live 30 minutes before the start, and the guard holds the bay until ${formatTime(r.arriveBy)}.',
          style: T.body(18, color: C.muted),
        ),
        _Plate(r: r),
        Container(
          margin: const EdgeInsets.only(top: 24),
          padding: const EdgeInsets.only(top: 20),
          decoration: const BoxDecoration(border: Border(top: BorderSide(color: C.line))),
          child: CancelSchedule(steps: r.cancelSchedule, noShowCents: r.feeCents, now: now),
        ),
      ]),
    );
  }
}

class _Live extends StatelessWidget {
  const _Live({required this.r, required this.now, required this.busy, required this.onCheckIn});
  final ReservationView r;
  final int now;
  final String? busy;
  final VoidCallback onCheckIn;
  @override
  Widget build(BuildContext context) {
    final before = now < r.start;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (r.carAtBay) ...[
        Note.text('The camera saw a car but couldn’t read its plate. If that’s you, tap “I’m at the bay”.', icon: LucideIcons.scanLine),
        const SizedBox(height: 16),
      ],
      _InkCard(children: [
        StatusChip(
          'Held for you',
          bg: C.signal,
          fg: C.ink,
          leading: Container(width: 8, height: 8, decoration: const BoxDecoration(color: C.ink, shape: BoxShape.circle)),
        ),
        const SizedBox(height: 16),
        Text((before ? 'Starts at ${formatTime(r.start)}, in' : 'Arrive by ${formatTime(r.arriveBy)}').toUpperCase(), style: T.mono(14, color: C.onBrandMuted)),
        const SizedBox(height: 4),
        _bigClock(formatCountdown((before ? r.start : r.arriveBy) - now)),
        const SizedBox(height: 12),
        Text(
          '${before ? 'The guard keeps the bay free for you.' : 'left to arrive.'} When you drive in, the camera reads your plate and lowers the guard.',
          style: T.body(14, color: C.onBrandMuted),
        ),
        _Plate(r: r, onDark: true),
      ]),
      const SizedBox(height: 16),
      // the fallback check-in only opens once the bay has seen a car (server-checked too)
      if (r.carAtBay)
        Btn('I’m at the bay', size: BtnSize.lg, icon: LucideIcons.mapPin, loading: busy == 'checkin', onPressed: onCheckIn)
      else
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4),
          child: Text('Plate not read? Once the camera has seen your car, you can check in here.', style: T.body(14, color: C.muted)),
        ),
    ]);
  }
}

class _Blocked extends StatelessWidget {
  const _Blocked({required this.r, required this.from, required this.busy, required this.onCancel, required this.onBookInstead});
  final ReservationView r;
  final Point? from;
  final String? busy;
  final VoidCallback onCancel;
  final ValueChanged<Bay> onBookInstead;
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(color: C.warnTint, borderRadius: BorderRadius.circular(24)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Icon(LucideIcons.triangleAlert, size: 32, color: C.warn),
            const SizedBox(height: 12),
            Text('Your bay is occupied', style: T.display(40)),
            const SizedBox(height: 8),
            Text(
              'Another car is in the bay. Your arrival deadline waits for as long as it’s there${r.real ? ', and we’ve alerted the operator' : ''}.',
              style: T.body(18),
            ),
            const SizedBox(height: 4),
            Text('Since ${formatTime(r.blockedSince ?? 0)}. Cancelling now is free.', style: T.body(16, color: C.muted)),
            if (r.creditGrantedCents > 0) ...[
              const SizedBox(height: 16),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                decoration: BoxDecoration(color: C.surface, borderRadius: BorderRadius.circular(16)),
                child: Text(
                  '${formatEuro(r.creditGrantedCents)} credit is on your account for the trouble. It’s used on your next booking.',
                  style: T.body(16, weight: FontWeight.w600),
                ),
              ),
            ],
          ]),
        ),
        const SizedBox(height: 16),
        Panel(
          padding: const EdgeInsets.all(24),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text('Free chargers nearby', style: T.display(26, height: 1)),
            const SizedBox(height: 12),
            AlternativeList(bays: r.alternatives, from: from, onBook: onBookInstead),
            Container(
              margin: const EdgeInsets.only(top: 16),
              padding: const EdgeInsets.only(top: 16),
              decoration: const BoxDecoration(border: Border(top: BorderSide(color: C.line))),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Btn('Cancel for free', variant: BtnVariant.danger, loading: busy == 'cancel', onPressed: onCancel),
              ),
            ),
          ]),
        ),
      ]);
}

class _Arrived extends StatelessWidget {
  const _Arrived({required this.r, required this.busy, required this.onCharge});
  final ReservationView r;
  final String? busy;
  final VoidCallback onCharge;
  @override
  Widget build(BuildContext context) {
    final how = r.checkInMethod == 'fallback'
        ? 'You checked in at the bay yourself.'
        : r.checkInMethod == 'walkup'
            ? 'You unlocked the bay at the charger.'
            : r.matchedBy == 'fuzzy'
                ? 'The camera recognised your plate, even though it misread a character.'
                : 'The camera recognised your plate.';
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _InkCard(children: [
        const Icon(LucideIcons.circleCheck, size: 36, color: C.mint),
        const SizedBox(height: 12),
        Text('You’re checked in', style: T.display(40, color: C.onBrand, height: 0.9)),
        const SizedBox(height: 8),
        Text('$how The guard is down: park and plug in.', style: T.body(18, color: C.onBrand)),
        if (r.arrivedAt != null) ...[
          const SizedBox(height: 8),
          Text('Arrived at ${formatTime(r.arrivedAt!)}'.toUpperCase(), style: T.mono(14, color: C.onBrandMuted)),
        ],
      ]),
      const SizedBox(height: 16),
      Btn('Start charging', size: BtnSize.lg, icon: LucideIcons.plugZap, loading: busy == 'charge', onPressed: onCharge),
    ]);
  }
}

// Charging, or a walk-up session: both end at r.end, then 5 free minutes, then the idle fee
class _Session extends StatelessWidget {
  const _Session({required this.r, required this.now, required this.busy, required this.onFinish});
  final ReservationView r;
  final int now;
  final String? busy;
  final VoidCallback onFinish;
  @override
  Widget build(BuildContext context) {
    final left = r.end - now;
    final walkup = r.status == 'walkup';
    final text = left > 0
        ? walkup
            ? 'The next booking starts after ${formatTime(r.end)}, so the bay is yours until then.'
            : 'Charging since ${formatTime(r.chargingAt ?? r.start)}. When you drive off, the camera ends the session.'
        : now < r.end + idleGraceMs
            ? 'Your ${idleGraceMs ~/ minute} free minutes to leave run until ${formatTime(r.end + idleGraceMs)}.'
            : 'The idle fee is running: ${formatEuro(idleCentsPerMin)} a minute, up to ${formatEuro(overstayCapCents)}.';
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _InkCard(children: [
        StatusChip(walkup ? 'Walk-up' : 'Charging', bg: C.signal, fg: C.ink, leading: const Icon(LucideIcons.plugZap, size: 16, color: C.ink)),
        const SizedBox(height: 16),
        Text((left > 0 ? '${walkup ? 'Free until' : 'Until'} ${formatTime(r.end)}, left' : 'Slot over').toUpperCase(), style: T.mono(14, color: C.onBrandMuted)),
        const SizedBox(height: 4),
        _bigClock(left > 0 ? formatCountdown(left) : _elapsed(now - r.end)),
        const SizedBox(height: 12),
        Text(text, style: T.body(16, color: C.onBrandMuted)),
      ]),
      const SizedBox(height: 16),
      Btn('Finish and leave', size: BtnSize.lg, loading: busy == 'finish', onPressed: onFinish),
    ]);
  }
}

class _Done extends StatelessWidget {
  const _Done({required this.r});
  final ReservationView r;

  (String, String) _text() {
    Charge? over;
    for (final c in r.charges) {
      if (c.kind == 'overstay') over = c;
    }
    if (r.status == 'completed') {
      return (
        'Session complete',
        over != null
            ? 'Thanks for charging. You stayed past the free minutes, so idle time was added: ${formatEuro(over.cents)}.'
            : 'Thanks for charging. The bay is free for the next driver.',
      );
    }
    if (r.status == 'cancelled') {
      return (
        'Booking cancelled',
        r.totalCents != 0 ? 'The bay is free again. Cancelling cost ${formatEuro(r.totalCents)}; the rest was returned.' : 'The bay is free again. Nothing was charged.',
      );
    }
    return ('You didn’t arrive in time', 'You didn’t arrive by ${formatTime(r.arriveBy)}, so the bay went to the next driver. The ${formatEuro(r.feeCents)} fee is kept.');
  }

  @override
  Widget build(BuildContext context) {
    final (title, text) = _text();
    final rows = <(String, String)>[
      ('Booked', formatTime(r.createdAt)),
      if (r.arrivedAt != null) ('Checked in', formatTime(r.arrivedAt!)),
      if (r.chargingAt != null && r.endedAt != null) ('Charged for', duration(r.endedAt! - r.chargingAt!)),
    ];
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Panel(
        padding: const EdgeInsets.all(24),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(title, style: T.display(40, height: 0.9)),
          const SizedBox(height: 8),
          Text(text, style: T.body(18, color: C.muted)),
          Container(
            margin: const EdgeInsets.only(top: 24),
            padding: const EdgeInsets.only(top: 20),
            decoration: const BoxDecoration(border: Border(top: BorderSide(color: C.line))),
            child: LayoutBuilder(builder: (context, c) {
              final w = (c.maxWidth - 24) / 2;
              return Wrap(spacing: 24, runSpacing: 12, children: [
                for (final (k, v) in rows)
                  SizedBox(
                    width: w,
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(k.toUpperCase(), style: T.mono(12, em: 0.1, color: C.muted)),
                      const SizedBox(height: 2),
                      Text(v, style: T.mono(18, weight: FontWeight.w600, em: 0, color: C.ink)),
                    ]),
                  ),
              ]);
            }),
          ),
        ]),
      ),
      const SizedBox(height: 16),
      Panel(
        padding: const EdgeInsets.all(24),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Receipt', style: T.display(26, height: 1)),
          const SizedBox(height: 16),
          Receipt(charges: r.charges, totalCents: r.totalCents),
        ]),
      ),
      const SizedBox(height: 16),
      Wrap(spacing: 12, runSpacing: 12, children: [
        Btn('Back to the map', size: BtnSize.lg, onPressed: () => goTab(context, AppTab.explore)),
        Btn('All bookings', variant: BtnVariant.secondary, size: BtnSize.lg, onPressed: () => goTab(context, AppTab.bookings)),
      ]),
    ]);
  }
}

class _CancelSheet extends StatefulWidget {
  const _CancelSheet({required this.r, required this.onConfirm});
  final ReservationView r;
  final Future<String?> Function() onConfirm;
  @override
  State<_CancelSheet> createState() => _CancelSheetState();
}

class _CancelSheetState extends State<_CancelSheet> {
  bool _busy = false;
  String _error = '';

  Future<void> _confirm() async {
    setState(() {
      _busy = true;
      _error = '';
    });
    final err = await widget.onConfirm();
    if (!mounted) return;
    if (err == null) return Navigator.of(context).pop();
    setState(() {
      _busy = false;
      _error = err;
    });
  }

  @override
  Widget build(BuildContext context) {
    final fee = widget.r.cancelNowCents ?? 0;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(
        fee == 0 ? 'Cancelling now is free: you get everything back.' : 'Cancelling now costs ${formatEuro(fee)}. The rest of what you paid comes back.',
        style: T.body(18),
      ),
      const SizedBox(height: 8),
      Text('That’s always less than not turning up. The bay is free for other drivers straight away.', style: T.body(16, color: C.muted)),
      if (_error.isNotEmpty) ...[const SizedBox(height: 16), ErrorNote(_error)],
      const SizedBox(height: 24),
      Wrap(spacing: 12, runSpacing: 12, children: [
        Btn('Cancel booking', variant: BtnVariant.danger, size: BtnSize.lg, loading: _busy, onPressed: _confirm),
        Btn('Keep it', variant: BtnVariant.secondary, size: BtnSize.lg, onPressed: () => Navigator.of(context).pop()),
      ]),
    ]);
  }
}

// Another registered car, or a one-off plate for today (erased when the booking ends)
class _OtherCarSheet extends StatefulWidget {
  const _OtherCarSheet({required this.onSubmit});
  final Future<String?> Function(Map<String, Object?> body) onSubmit;
  @override
  State<_OtherCarSheet> createState() => _OtherCarSheetState();
}

class _OtherCarSheetState extends State<_OtherCarSheet> {
  List<Vehicle> _cars = [];
  final _plate = TextEditingController();
  bool _consent = false, _busy = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    api.vehicles().then((c) => mounted ? setState(() => _cars = c) : null, onError: (_) {});
  }

  @override
  void dispose() {
    _plate.dispose();
    super.dispose();
  }

  Future<void> _submit(Map<String, Object?> body) async {
    setState(() {
      _busy = true;
      _error = '';
    });
    final err = await widget.onSubmit(body);
    if (!mounted) return;
    if (err == null) return Navigator.of(context).pop();
    setState(() {
      _busy = false;
      _error = err;
    });
  }

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (_cars.length > 1) ...[
          Text('One of your cars', style: T.body(16, weight: FontWeight.w600)),
          const SizedBox(height: 8),
          for (final c in _cars)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Material(
                color: C.surface,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: const BorderSide(color: C.lineStrong)),
                child: InkWell(
                  customBorder: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  hoverColor: C.brandTint,
                  onTap: _busy ? null : () => _submit({'vehicleId': c.id}),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(minHeight: 44),
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Row(children: [
                        PlateBadge(c.display, size: PlateSize.sm),
                        const SizedBox(width: 16),
                        Expanded(child: Text(c.label, style: T.body(16, weight: FontWeight.w500))),
                      ]),
                    ),
                  ),
                ),
              ),
            ),
          const SizedBox(height: 12),
        ],
        Text('Or add today’s plate, and the camera lets that car in too. It’s forgotten when the booking ends.', style: T.body(16, color: C.muted)),
        const SizedBox(height: 20),
        Field(label: 'Today’s licence plate', child: PlateField(controller: _plate, hint: 'B XY 123', onChanged: (_) => setState(() {}))),
        const SizedBox(height: 20),
        ConsentBox(value: _consent, onChanged: (v) => setState(() => _consent = v), child: const Text('Use this plate to check me in for this booking only.')),
        if (_error.isNotEmpty) ...[const SizedBox(height: 16), ErrorNote(_error)],
        const SizedBox(height: 20),
        Btn(
          'Add plate',
          size: BtnSize.lg,
          loading: _busy,
          onPressed: _plate.text.trim().isEmpty || !_consent ? null : () => _submit({'plate': _plate.text, 'consent': true}),
        ),
      ]);
}
