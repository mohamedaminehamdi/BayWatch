import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../api.dart';
import '../format.dart';
import '../sign_in.dart';
import '../theme.dart';
import '../ui.dart';

// The signed-out start screen: what Baywatch does, the rules and the prices, and the way in.
// web/app/(marketing)/page.tsx and web/components/landing/*.

// ── every number on this page comes from the booking rules, so the copy can't drift from them ──
// web/lib/booking-rules.ts (bookingFee, cancelSchedule, DEMAND), web/lib/pricing.ts and web/lib/revenue.ts

const _baseFeeCents = 500; // BASE_FEE_CENTS: €5 × class × demand
const _maxFeeCents = 1000; // MAX_RESERVATION_CENTS
const _demand = {'quiet': 80, 'normal': 100, 'busy': 150, 'full': 200}; // percent
const _bayGuardPerBayMonth = 1900; // PRICES.bayGuardPerBayMonth
const _blockedDcHourMargin = 1200; // BLOCKED_DC_HOUR_MARGIN
const _cpoReservationShare = 0.7;
const _cpoOverstayShare = 0.5;

int _bookingFee(String cls, String level) => math.min(_baseFeeCents * (classes[cls]!.percent * _demand[level]! ~/ 100) ~/ 100, _maxFeeCents);

// Cancelling, measured from the start: free a day or more ahead, then 10%, 50% from 30 min before and 80% from 5 min
// before. Free in the first 2 min after booking.
const _cancelBefore = [(before: day, percent: 0), (before: 30 * minute, percent: 10), (before: 5 * minute, percent: 50)];
int _cancelPercent(int bookedAt, int start, int at) {
  if (at - bookedAt <= freeCancelMs) return 0;
  return _cancelBefore.where((t) => start - at >= t.before).firstOrNull?.percent ?? 80;
}

List<({int from, int percent})> _cancelSchedule(int bookedAt, int start) {
  final moments = [bookedAt, bookedAt + freeCancelMs + 1, for (final t in _cancelBefore) start - t.before + 1].where((t) => t >= bookedAt).toList()..sort();
  final steps = <({int from, int percent})>[];
  for (final from in moments) {
    final p = _cancelPercent(bookedAt, start, from);
    if (steps.isEmpty || steps.last.percent != p) steps.add((from: from, percent: p));
  }
  return steps;
}

String _dur(int ms) => ms >= hour ? '${(ms / hour).round()} h' : '${(ms / minute).round()} min';
String _x(int percent) => '×${percent / 100}';

// the lowest fee there is: the slowest class at the quietest time
final _fromCents = [
  for (final c in classes.keys)
    for (final l in _demand.keys) _bookingFee(c, l),
].reduce(math.min);
// the paid cancelling steps of a booking made three days ahead, as times before its start
const _ahead = 72 * hour;
final _paid = [
  for (final s in _cancelSchedule(0, _ahead))
    if (s.percent > 0) (percent: s.percent, before: _dur(_ahead - s.from + 1)),
];

final _steps = [
  (scene: Scene.find, title: 'Find', text: 'Search chargers on the map and pick one. Every charger can be booked through Baywatch.'),
  (
    scene: Scene.guarded,
    title: 'Book',
    text:
        'Pick a day up to ${(horizonMs / day).round()} days ahead, then a start and a length in ${(blockMs / minute).round()}-minute blocks. The guard keeps the bay free for you.',
  ),
  (
    scene: Scene.arriving,
    title: 'Arrive',
    text: 'The camera reads your plate and lowers the guard. You can arrive up to ${(arrivalGraceMs / minute).round()} minutes after your start.',
  ),
  (scene: Scene.charging, title: 'Charge', text: 'Plug in as usual. When you drive off, the bay is free for the next driver.'),
];

final _covered = [
  (
    icon: LucideIcons.triangleAlert,
    title: 'Someone parked in your bay',
    text:
        'The operator is alerted, you see the nearest free chargers and you get ${formatEuro(blockedCreditCents)} credit. Cancelling is free, and if the bay clears, you get the lost time back.',
  ),
  (
    icon: LucideIcons.scanLine,
    title: 'The camera misreads your plate',
    text: 'Dirt, glare and look-alike characters (B and 8, O and 0) still match your car. If nothing reads, tap “I’m at the bay”.',
  ),
  (icon: LucideIcons.carFront, title: 'You’re in a different car today', text: 'Add today’s plate to the booking. It’s forgotten as soon as you leave.'),
];

final _driverRules = [
  'Busy hours ${_x(_demand['busy']!)}, quiet nights ${_x(_demand['quiet']!)}, and never more than ${formatEuro(_maxFeeCents)}',
  'Free to cancel until ${_paid.first.before} before the start, and for ${(freeCancelMs / minute).round()} min after booking. Then ${_paid.first.percent}%, '
      '${_paid.skip(1).map((s) => '${s.percent}% from ${s.before} before').join(' and ')}',
  'Arrive up to ${(arrivalGraceMs / minute).round()} min after your start. After that it’s a no-show and the fee is kept',
  '${(idleGraceMs / minute).round()} free minutes after your slot, then ${formatEuro(idleCentsPerMin)} a minute, at most ${formatEuro(overstayCapCents)}',
  'Your first booking is free',
];

final _operatorRules = [
  'Blocked-bay alerts by email and on the dashboard',
  'Utilisation, no-show and check-in numbers per bay',
  '${(_cpoReservationShare * 100).round()}% of every booking fee and ${(_cpoOverstayShare * 100).round()}% of idle fees go to you',
  'An open, OCPI-style API so other apps can book your bays',
];

// a ruled table, keyed in mono, rather than three icon cards
const _privacy = [
  (key: 'Consent', title: 'You agree once', text: 'Plate recognition only starts after you add your car and say yes.'),
  (key: 'Matching', title: 'Matched to your booking only', text: 'The camera compares a read plate with the one active booking. Nothing else is looked up.'),
  (
    key: 'Deletion',
    title: 'Forgotten after the session',
    text: 'Your booking drops the plate when it ends. A blocking car’s plate is kept only until the incident is resolved.',
  ),
];

// ── the page ──

TextStyle get _h2 => T.display(40, height: 0.9);

// Ecurious's container, at phone width: content centred, at most 720 px
Widget _wrap(Widget child, {EdgeInsets padding = const EdgeInsets.symmetric(horizontal: 20)}) => Center(
  child: ConstrainedBox(
    constraints: const BoxConstraints(maxWidth: 720),
    child: Padding(padding: padding, child: child),
  ),
);

// Ecurious's square bullet: decorative, the text says it all
Widget _bullet(String text, {Color color = C.ink}) => Padding(
  padding: const EdgeInsets.only(bottom: 14),
  child: Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Container(width: 8, height: 8, margin: const EdgeInsets.only(top: 8, right: 12), color: C.signal),
      Expanded(
        child: Text(text, style: T.body(16, color: color)),
      ),
    ],
  ),
);

void _signIn(BuildContext context, {bool signUp = false}) => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => SignInScreen(signUp: signUp)));

class LandingScreen extends StatefulWidget {
  const LandingScreen({super.key});
  @override
  State<LandingScreen> createState() => _LandingScreenState();
}

class _LandingScreenState extends State<LandingScreen> {
  final _how = GlobalKey();

  @override
  Widget build(BuildContext context) {
    final arrow = LucideIcons.arrowRight;
    return Scaffold(
      body: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // ── header and hero, on paper ──
            SafeArea(
              bottom: false,
              child: _wrap(
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 20),
                  child: Row(
                    children: [
                      const Logo(),
                      const Spacer(),
                      Btn('Sign in', variant: BtnVariant.secondary, size: BtnSize.sm, onPressed: () => _signIn(context)),
                    ],
                  ),
                ),
              ),
            ),
            _wrap(
              Padding(
                padding: const EdgeInsets.only(top: 8, bottom: 64),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const _Rise(delay: 0, child: _LiveBayStatus()),
                    const SizedBox(height: 24),
                    _Rise(
                      delay: 80,
                      child: Text.rich(
                        TextSpan(
                          children: [
                            const TextSpan(text: 'Your charging spot, '),
                            TextSpan(
                              text: 'kept free.',
                              style: const TextStyle(color: C.accent),
                            ),
                          ],
                        ),
                        style: T.display(56, height: 0.88),
                      ),
                    ),
                    const SizedBox(height: 24),
                    _Rise(
                      delay: 160,
                      child: Text(
                        'Book a public charger before you set off. A guard holds the bay for your slot, and the camera lets your car in when you arrive.',
                        style: T.body(19, color: C.muted, height: 1.5),
                      ),
                    ),
                    const SizedBox(height: 36),
                    _Rise(
                      delay: 240,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Btn('Book a bay', trailingIcon: arrow, variant: BtnVariant.signal, size: BtnSize.lg, onPressed: () => _signIn(context, signUp: true)),
                          const SizedBox(height: 12),
                          Btn(
                            'How it works',
                            variant: BtnVariant.secondary,
                            size: BtnSize.lg,
                            onPressed: () =>
                                Scrollable.ensureVisible(_how.currentContext!, duration: const Duration(milliseconds: 500), curve: Curves.easeOutCubic),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 28),
                    _Rise(
                      delay: 320,
                      child: Text(
                        'FROM ${formatEuro(_fromCents)} PER BOOKING · FREE TO CANCEL UNTIL ${_paid.first.before.toUpperCase()} BEFORE · PLATE DELETED AFTER EVERY SESSION',
                        style: T.mono(12, color: C.muted).copyWith(height: 1.6),
                      ),
                    ),
                    const SizedBox(height: 48),
                    // the app and the bay, side by side, tilted and floating like Ecurious's product shots
                    const _Rise(delay: 200, child: _HeroShots()),
                  ],
                ),
              ),
            ),

            // streams in: a slow GoingElectric answer never holds up the page
            const _NearbyChargers(),

            // ── four steps ──
            _wrap(
              Padding(
                key: _how,
                padding: const EdgeInsets.symmetric(vertical: 80),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('Four steps from the road to the plug', style: _h2),
                    const SizedBox(height: 24),
                    Text(
                      'No more circling the car park. The bay is guarded from the moment you book until your car is the one standing in it.',
                      style: T.body(18, color: C.muted),
                    ),
                    const SizedBox(height: 48),
                    // a spec-sheet grid: hairlines, no gaps, square corners
                    Container(
                      decoration: const BoxDecoration(
                        border: Border(
                          left: BorderSide(color: C.line),
                          top: BorderSide(color: C.line),
                        ),
                      ),
                      child: Column(
                        children: [
                          for (final (i, s) in _steps.indexed)
                            Container(
                              padding: const EdgeInsets.all(20),
                              decoration: const BoxDecoration(
                                color: C.surface,
                                border: Border(
                                  right: BorderSide(color: C.line),
                                  bottom: BorderSide(color: C.line),
                                ),
                              ),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Container(
                                    width: 104,
                                    padding: const EdgeInsets.fromLTRB(8, 8, 8, 4),
                                    decoration: BoxDecoration(color: C.page, borderRadius: BorderRadius.circular(12)),
                                    child: BaySketch(s.scene, width: 88),
                                  ),
                                  const SizedBox(width: 20),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Row(
                                          crossAxisAlignment: CrossAxisAlignment.baseline,
                                          textBaseline: TextBaseline.alphabetic,
                                          children: [
                                            Text('${i + 1}'.padLeft(2, '0'), style: T.mono(12, em: 0.12, color: C.accent)),
                                            const SizedBox(width: 12),
                                            Text(s.title, style: T.display(30, height: 1)),
                                          ],
                                        ),
                                        const SizedBox(height: 6),
                                        Text(s.text, style: T.body(16, color: C.muted)),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // ── at the bay: covered ──
            Container(
              color: C.surface,
              padding: const EdgeInsets.symmetric(vertical: 80),
              child: _wrap(
                Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('When the bay doesn’t play along, you’re covered', style: _h2),
                    const SizedBox(height: 40),
                    Container(
                      decoration: const BoxDecoration(
                        border: Border(
                          top: BorderSide(color: C.line),
                          bottom: BorderSide(color: C.line),
                        ),
                      ),
                      child: Column(
                        children: [
                          for (final (i, c) in _covered.indexed)
                            Container(
                              padding: const EdgeInsets.symmetric(vertical: 24),
                              decoration: BoxDecoration(
                                border: i == 0 ? null : const Border(top: BorderSide(color: C.line)),
                              ),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Padding(
                                    padding: const EdgeInsets.only(top: 3),
                                    child: Icon(c.icon, size: 20, color: C.ink),
                                  ),
                                  const SizedBox(width: 16),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(c.title, style: T.body(18, weight: FontWeight.w600)),
                                        const SizedBox(height: 4),
                                        Text(c.text, style: T.body(16, color: C.muted)),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 48),
                    Container(
                      padding: const EdgeInsets.fromLTRB(32, 72, 32, 32),
                      decoration: BoxDecoration(color: C.sunken, borderRadius: BorderRadius.circular(24)),
                      child: Stack(
                        clipBehavior: Clip.none,
                        children: [
                          const Center(child: BaySketch(Scene.blocked, width: 280)),
                          Positioned(
                            left: -8,
                            top: -48,
                            child: Container(
                              padding: const EdgeInsets.fromLTRB(8, 6, 14, 6),
                              decoration: BoxDecoration(
                                color: C.surface,
                                borderRadius: BorderRadius.circular(99),
                                border: Border.all(color: C.line),
                                boxShadow: [BoxShadow(color: C.ink.withValues(alpha: 0.18), blurRadius: 10, offset: const Offset(0, 2))],
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Container(
                                    width: 24,
                                    height: 24,
                                    decoration: const BoxDecoration(color: C.warnTint, shape: BoxShape.circle),
                                    child: const Icon(LucideIcons.triangleAlert, size: 14, color: C.warn),
                                  ),
                                  const SizedBox(width: 8),
                                  Text(
                                    'DEADLINE PAUSED · OPERATOR ALERTED',
                                    style: T.mono(12, weight: FontWeight.w600, color: C.ink),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // ── pricing ──
            _wrap(
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 80),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('Simple prices, fair rules', style: _h2),
                    const SizedBox(height: 48),
                    _DriverPricing(onBook: () => _signIn(context, signUp: true)),
                    const SizedBox(height: 20),
                    const _OperatorPricing(),
                    const SizedBox(height: 24),
                    Text('Prototype: payments are simulated and no card is charged.', style: T.body(14, color: C.muted)),
                  ],
                ),
              ),
            ),

            // ── privacy ──
            Container(
              color: C.brandStrong,
              padding: const EdgeInsets.symmetric(vertical: 80),
              child: _wrap(
                Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('Your plate is used at the bay, then forgotten', style: _h2.copyWith(color: C.onBrand)),
                    const SizedBox(height: 48),
                    Container(
                      decoration: const BoxDecoration(
                        border: Border(top: BorderSide(color: C.signal, width: 2)),
                      ),
                      child: Column(
                        children: [
                          for (final (i, p) in _privacy.indexed)
                            Container(
                              width: double.infinity,
                              padding: const EdgeInsets.symmetric(vertical: 32),
                              decoration: BoxDecoration(
                                border: i == 0 ? null : Border(top: BorderSide(color: Colors.white.withValues(alpha: 0.14))),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(p.key.toUpperCase(), style: T.mono(12, em: 0.14, color: C.onBrandAccent)),
                                  const SizedBox(height: 16),
                                  Text(p.title, style: T.display(30, height: 1, color: C.onBrand)),
                                  const SizedBox(height: 12),
                                  Text(p.text, style: T.body(16, color: C.onBrandMuted)),
                                ],
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // ── the last call ──
            Container(
              color: C.brandDeep,
              padding: const EdgeInsets.symmetric(vertical: 80),
              child: _wrap(
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text.rich(
                      TextSpan(
                        children: [
                          const TextSpan(text: 'Set off knowing '),
                          TextSpan(
                            text: 'a bay is waiting.',
                            style: const TextStyle(color: C.onBrandAccent),
                          ),
                        ],
                      ),
                      style: _h2.copyWith(color: C.onBrand),
                    ),
                    const SizedBox(height: 32),
                    Wrap(
                      spacing: 12,
                      runSpacing: 12,
                      children: [
                        Btn('Book a bay', trailingIcon: arrow, variant: BtnVariant.signal, size: BtnSize.lg, onPressed: () => _signIn(context, signUp: true)),
                        Btn('Sign in', variant: BtnVariant.onBrand, size: BtnSize.lg, onPressed: () => _signIn(context)),
                      ],
                    ),
                  ],
                ),
              ),
            ),

            const _Footer(),
          ],
        ),
      ),
    );
  }
}

class _DriverPricing extends StatelessWidget {
  const _DriverPricing({required this.onBook});
  final VoidCallback onBook;

  @override
  Widget build(BuildContext context) {
    Widget cell(String text, TextStyle style, {bool right = false}) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Text(text, textAlign: right ? TextAlign.right : TextAlign.left, style: style),
    );
    final head = T.mono(12, color: C.muted, em: 0.1);
    return Panel(
      radius: 24,
      padding: const EdgeInsets.all(32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('FOR DRIVERS', style: T.mono(12, color: C.muted, em: 0.14)),
          const SizedBox(height: 16),
          Wrap(
            spacing: 12,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.end,
            children: [
              Text('FROM', style: T.mono(14, color: C.muted)),
              Text(formatEuro(_fromCents), style: T.display(72, height: 0.9, color: C.accent)),
              Text('PER BOOKING', style: T.mono(14, color: C.muted)),
            ],
          ),
          const SizedBox(height: 32),
          Text('One fee per booking, whatever its length. At normal demand:', style: T.body(14, color: C.muted)),
          const SizedBox(height: 12),
          Table(
            columnWidths: const {0: FlexColumnWidth(1.4), 1: FlexColumnWidth(), 2: IntrinsicColumnWidth()},
            border: const TableBorder(
              horizontalInside: BorderSide(color: C.line),
              bottom: BorderSide(color: C.line),
            ),
            children: [
              TableRow(
                children: [
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text('CHARGER', style: head),
                  ),
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text('BOOK UP TO', style: head),
                  ),
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text('FEE', textAlign: TextAlign.right, style: head),
                  ),
                ],
              ),
              for (final e in classes.entries)
                TableRow(
                  children: [
                    cell(e.value.label, T.body(16, weight: FontWeight.w600)),
                    cell(_dur(e.value.maxBlocks * blockMs), T.mono(14, em: 0, color: C.ink)),
                    cell(formatEuro(_bookingFee(e.key, 'normal')), T.mono(16, weight: FontWeight.w600, em: 0, color: C.ink), right: true),
                  ],
                ),
            ],
          ),
          const SizedBox(height: 32),
          for (final r in _driverRules) _bullet(r),
          const SizedBox(height: 26),
          Align(
            alignment: Alignment.centerLeft,
            child: Btn('Book a bay', trailingIcon: LucideIcons.arrowRight, size: BtnSize.lg, onPressed: onBook),
          ),
        ],
      ),
    );
  }
}

class _OperatorPricing extends StatelessWidget {
  const _OperatorPricing();
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(32),
    decoration: BoxDecoration(color: C.brandDeep, borderRadius: BorderRadius.circular(24)),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('FOR CHARGE POINT OPERATORS', style: T.mono(12, color: C.onBrandMuted, em: 0.14)),
        const SizedBox(height: 16),
        Wrap(
          spacing: 12,
          runSpacing: 4,
          crossAxisAlignment: WrapCrossAlignment.end,
          children: [
            Text(formatEuro(_bayGuardPerBayMonth), style: T.display(72, height: 0.9, color: C.signal)),
            Text('PER BAY PER MONTH', style: T.mono(14, color: C.onBrandMuted)),
          ],
        ),
        const SizedBox(height: 12),
        Text('BAY GUARD', style: T.mono(12, color: C.onBrandAccent, em: 0.14)),
        const SizedBox(height: 24),
        for (final r in _operatorRules) _bullet(r, color: C.onBrand),
        const SizedBox(height: 18),
        Text(
          'An hour of a blocked DC bay loses about ${formatEuro(_blockedDcHourMargin)} in margin. '
          'Preventing ${(_bayGuardPerBayMonth / _blockedDcHourMargin).ceil()} blockings a month pays for the plan.',
          style: T.body(16, color: C.onBrandMuted),
        ),
        const SizedBox(height: 32),
        // no self-serve operator sign-up yet: a plain line of text, deliberately not styled like a button
        Row(
          children: [
            const Icon(LucideIcons.messagesSquare, size: 20, color: C.signal),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                'Talk to us at our stand.',
                style: T.body(18, weight: FontWeight.w600, color: C.onBrand),
              ),
            ),
          ],
        ),
      ],
    ),
  );
}

class _Footer extends StatelessWidget {
  const _Footer();
  @override
  Widget build(BuildContext context) {
    final style = T.mono(12, em: 0.06, color: C.onBrandMuted).copyWith(height: 1.6);
    Widget link(String text, String url) => InkWell(
      onTap: () => openUrl(Uri.parse(url)),
      child: Text(
        text,
        style: style.copyWith(decoration: TextDecoration.underline, decorationColor: C.onBrandMuted),
      ),
    );
    return Container(
      decoration: BoxDecoration(
        color: C.brandDeep,
        border: Border(top: BorderSide(color: Colors.white.withValues(alpha: 0.14))),
      ),
      child: SafeArea(
        top: false,
        child: _wrap(
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 48),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Logo(light: true),
                const SizedBox(height: 12),
                Text('A hackathon prototype for reserving public chargers.', style: T.body(14, color: C.onBrandMuted)),
                const SizedBox(height: 24),
                Wrap(
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text('CHARGING DATA © ', style: style),
                    link('GOINGELECTRIC.DE', 'https://www.goingelectric.de/stromtankstellen/'),
                    Text('. MAP DATA © ', style: style),
                    link('OPENSTREETMAP', 'https://www.openstreetmap.org/copyright'),
                    Text(' CONTRIBUTORS, TILES BY ', style: style),
                    link('MAPTILER', 'https://www.maptiler.com/copyright/'),
                    Text('.', style: style),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ── hero pieces ──

/// Fades and rises into place once, after `delay` ms (the web's animate-rise)
class _Rise extends StatefulWidget {
  const _Rise({required this.delay, required this.child});
  final int delay;
  final Widget child;
  @override
  State<_Rise> createState() => _RiseState();
}

class _RiseState extends State<_Rise> {
  bool _shown = false;
  Timer? _t;
  @override
  void initState() {
    super.initState();
    _t = Timer(Duration(milliseconds: widget.delay), () => mounted ? setState(() => _shown = true) : null);
  }

  @override
  void dispose() {
    _t?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedOpacity(
    opacity: _shown ? 1 : 0,
    duration: const Duration(milliseconds: 700),
    curve: const Cubic(0.16, 1, 0.3, 1),
    child: AnimatedSlide(
      offset: _shown ? Offset.zero : const Offset(0, 0.05),
      duration: const Duration(milliseconds: 700),
      curve: const Cubic(0.16, 1, 0.3, 1),
      child: widget.child,
    ),
  );
}

/// The Baywatch bays' status, straight from the public API. Hidden if the API can't be reached.
class _LiveBayStatus extends StatefulWidget {
  const _LiveBayStatus();
  @override
  State<_LiveBayStatus> createState() => _LiveBayStatusState();
}

class _LiveBayStatusState extends State<_LiveBayStatus> {
  List<Bay>? _bays;
  late final Timer _t;

  @override
  void initState() {
    super.initState();
    _load();
    _t = Timer.periodic(const Duration(seconds: 10), (_) => _load());
  }

  @override
  void dispose() {
    _t.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final s = await api.state();
      if (mounted) setState(() => _bays = s.realBays);
    } catch (_) {
      if (mounted) setState(() => _bays = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final bays = _bays;
    if (bays == null || bays.isEmpty) return const SizedBox(height: 20);
    // green: free and can be unlocked now, like the bays' LED. An ink dot with a lime halo (lime alone vanishes on paper).
    final free = bays.where((b) => b.green).length;
    final style = T.mono(13, em: 0.1, color: C.muted);
    return Semantics(
      liveRegion: true,
      child: Row(
        children: [
          SizedBox.square(
            dimension: 10,
            child: Stack(
              alignment: Alignment.center,
              children: [
                LiveDot(color: free > 0 ? C.signal : C.danger, size: 10),
                Container(
                  width: 10,
                  height: 10,
                  decoration: BoxDecoration(color: free > 0 ? C.ink : C.danger, shape: BoxShape.circle),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text.rich(
              TextSpan(
                children: [
                  const TextSpan(text: 'LIVE: '),
                  TextSpan(
                    text: '$free OF ${bays.length}',
                    style: const TextStyle(fontWeight: FontWeight.w600, color: C.ink),
                  ),
                  const TextSpan(text: ' BAYWATCH BAYS FREE RIGHT NOW'),
                ],
              ),
              style: style,
            ),
          ),
        ],
      ),
    );
  }
}

// The phone and the guarded bay, side by side: the phone floats, the card sits over its corner
class _HeroShots extends StatelessWidget {
  const _HeroShots();
  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: Center(
      child: SizedBox(
        width: 340,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Padding(
              padding: const EdgeInsets.only(left: 40, bottom: 120),
              child: Transform.rotate(
                angle: -4 * math.pi / 180,
                child: const _Float(child: _PhoneMockup()),
              ),
            ),
            Positioned(
              left: 0,
              bottom: 0,
              width: 176,
              child: Transform.rotate(
                angle: 5 * math.pi / 180,
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: C.brandDeep,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: Colors.white.withValues(alpha: 0.14)),
                    boxShadow: [BoxShadow(color: C.ink.withValues(alpha: 0.32), blurRadius: 50, offset: const Offset(0, 24))],
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const BaySketch(Scene.guarded, dark: true, width: 152),
                      const SizedBox(height: 4),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 4),
                        child: Text.rich(
                          const TextSpan(
                            children: [
                              TextSpan(
                                text: 'GUARD UP.',
                                style: TextStyle(color: C.onBrand),
                              ),
                              TextSpan(text: ' THE CAMERA WAITS FOR YOUR PLATE.'),
                            ],
                          ),
                          style: T.mono(11, em: 0.08, color: C.onBrandMuted).copyWith(height: 1.35),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

/// A slow bob, 10 px up and back (the web's animate-float)
class _Float extends StatefulWidget {
  const _Float({required this.child});
  final Widget child;
  @override
  State<_Float> createState() => _FloatState();
}

class _FloatState extends State<_Float> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 6500))..repeat();
  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: _c,
    builder: (_, child) => Transform.translate(offset: Offset(0, -10 * (1 - math.cos(2 * math.pi * _c.value)) / 2), child: child),
    child: widget.child,
  );
}

const _mockSteps = ['Booked', 'Live', 'Checked in', 'Charging', 'Done'];
const _mockAt = 1;

/// The booking screen as the driver sees it on the way to the bay. Decorative: the hero copy says the same in words.
class _PhoneMockup extends StatefulWidget {
  const _PhoneMockup();
  @override
  State<_PhoneMockup> createState() => _PhoneMockupState();
}

class _PhoneMockupState extends State<_PhoneMockup> {
  static const _grace = arrivalGraceMs ~/ 1000;
  int _left = _grace - 139;
  late final Timer _t = Timer.periodic(const Duration(seconds: 1), (_) => setState(() => _left = _left > 0 ? _left - 1 : _grace));

  @override
  void dispose() {
    _t.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    Widget fakeButton(String label, IconData icon, {required bool dark}) => Container(
      height: 44,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: ShapeDecoration(
        color: dark ? C.brand : C.surface,
        shape: StadiumBorder(side: dark ? BorderSide.none : const BorderSide(color: C.lineStrong)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 16, color: dark ? C.onBrand : C.ink),
          const SizedBox(width: 8),
          Text(
            label.toUpperCase(),
            style: T.mono(12, weight: FontWeight.w600, em: 0.06, color: dark ? C.onBrand : C.ink),
          ),
        ],
      ),
    );
    return Container(
      width: 280,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: C.ink,
        borderRadius: BorderRadius.circular(44),
        boxShadow: [BoxShadow(color: C.ink.withValues(alpha: 0.32), blurRadius: 50, offset: const Offset(0, 24))],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(36),
        child: Container(
          color: C.page,
          padding: const EdgeInsets.only(bottom: 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(24, 14, 24, 0),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Text('9:41', style: T.body(11, weight: FontWeight.w600)),
                    Container(
                      width: 80,
                      height: 20,
                      decoration: ShapeDecoration(color: C.ink, shape: const StadiumBorder()),
                    ),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        for (final h in [5.0, 7.0, 9.0, 11.0])
                          Container(
                            width: 4,
                            height: h,
                            margin: const EdgeInsets.only(left: 2),
                            decoration: BoxDecoration(color: C.ink, borderRadius: BorderRadius.circular(1)),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 20, 16, 0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('Your booking', style: T.display(20, height: 1)),
                    const SizedBox(height: 12),
                    // mirrors the live-booking card: ink, with the countdown in lime
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(color: C.brandDeep, borderRadius: BorderRadius.circular(16)),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                            decoration: const ShapeDecoration(color: C.signal, shape: StadiumBorder()),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const LiveDot(color: C.ink, size: 8),
                                const SizedBox(width: 6),
                                Text(
                                  'HELD FOR YOU',
                                  style: T.mono(10, weight: FontWeight.w600, color: C.ink),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: 8),
                          Text('${_left ~/ 60}:${(_left % 60).toString().padLeft(2, '0')}', style: T.display(64, height: 0.85, color: C.signal)),
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              const Icon(LucideIcons.timer, size: 14, color: C.onBrandMuted),
                              const SizedBox(width: 6),
                              Flexible(child: Text('LEFT TO ARRIVE · GUARD UP', style: T.mono(11, em: 0.06, color: C.onBrandMuted))),
                            ],
                          ),
                          Container(
                            margin: const EdgeInsets.only(top: 16),
                            padding: const EdgeInsets.only(top: 14),
                            decoration: BoxDecoration(
                              border: Border(top: BorderSide(color: Colors.white.withValues(alpha: 0.14))),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Baywatch Bay 1',
                                  style: T.body(15, weight: FontWeight.w600, color: C.onBrand, height: 1.2),
                                ),
                                const SizedBox(height: 6),
                                Row(
                                  children: [
                                    Expanded(
                                      child: Text('CCS · 200 KW · 1.2 KM', style: T.mono(11, em: 0.06, color: C.onBrandMuted)),
                                    ),
                                    const PlateBadge('M AB 1234', size: PlateSize.sm),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        for (final (i, s) in _mockSteps.indexed)
                          Expanded(
                            child: Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 2),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Container(
                                    height: 4,
                                    decoration: BoxDecoration(color: i <= _mockAt ? C.brand : C.line, borderRadius: BorderRadius.circular(99)),
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    s,
                                    style: T.body(
                                      9.5,
                                      weight: FontWeight.w600,
                                      height: 1.2,
                                      color: i == _mockAt
                                          ? C.ink
                                          : i < _mockAt
                                          ? C.muted
                                          : C.faint,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    fakeButton('Navigate by car', LucideIcons.navigation, dark: true),
                    const SizedBox(height: 8),
                    fakeButton('Different car today', LucideIcons.carFront, dark: false),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ── public chargers around the Baywatch bays ──

const _radiusKm = 2;
const _unitsPerM = 180 / (_radiusKm * 1000); // the 2 km ring has radius 180 in the 400×400 map

typedef _Dot = ({String name, double x, double y, double powerKw, double distance});

/// Real GoingElectric chargers around the Baywatch bays. Renders nothing without data (no key, or GE down).
class _NearbyChargers extends StatefulWidget {
  const _NearbyChargers();
  @override
  State<_NearbyChargers> createState() => _NearbyChargersState();
}

class _NearbyChargersState extends State<_NearbyChargers> {
  List<Bay> _bays = const [];
  List<_Dot> _dots = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final bays = (await api.state()).realBays;
      final bay = bays.firstOrNull;
      if (bay == null) return;
      final cos = math.cos(bay.lat * math.pi / 180);
      final dLat = _radiusKm * 1000 / 110574, dLng = _radiusKm * 1000 / (111320 * cos);
      final found = await api.bays(south: bay.lat - dLat, west: bay.lng - dLng, north: bay.lat + dLat, east: bay.lng + dLng);
      final dots =
          [
                for (final c in found.bays.where((b) => !b.real))
                  (
                    name: c.name,
                    x: 200 + (c.lng - bay.lng) * 111320 * cos * _unitsPerM,
                    y: 200 - (c.lat - bay.lat) * 110574 * _unitsPerM,
                    powerKw: c.powerKw,
                    distance: distanceM(bay.point, c.point),
                  ),
              ]
              // drop the bays themselves if GoingElectric lists them, and anything outside the outer ring
              .where((d) => d.distance > 15 && d.distance <= _radiusKm * 1000)
              .toList()
            ..sort((a, b) => b.distance.compareTo(a.distance));
      if (mounted) {
        setState(() {
          _bays = bays;
          _dots = dots;
        });
      }
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    if (_dots.isEmpty) return const SizedBox.shrink();
    final locks = _bays.where((b) => b.guard == 'hardware').length;
    final nearest = _dots.last;
    return _wrap(
      Padding(
        padding: const EdgeInsets.symmetric(vertical: 80),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text.rich(
              TextSpan(
                children: [
                  TextSpan(text: '${_dots.length} public chargers within $_radiusKm km. '),
                  const TextSpan(
                    text: 'Now each one can wait for you.',
                    style: TextStyle(color: C.accent),
                  ),
                ],
              ),
              style: _h2,
            ),
            const SizedBox(height: 24),
            Text(
              'Without a booking, any of these can be taken or blocked by the time you arrive, and you only find out when you get there. '
              'Book one through Baywatch and it’s held for your slot. The violet dot marks the ${_bays.length} Baywatch bays at the venue'
              '${locks > 0 ? ', $locks of them behind a real lock' : ''}.',
              style: T.body(18, color: C.muted),
            ),
            const SizedBox(height: 16),
            Wrap(
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text('LIVE DATA FROM ', style: T.mono(12, color: C.muted)),
                InkWell(
                  onTap: () => openUrl(Uri.parse('https://www.goingelectric.de/stromtankstellen/')),
                  child: Text(
                    'GOINGELECTRIC.DE',
                    style: T.mono(12, color: C.muted).copyWith(decoration: TextDecoration.underline, decorationColor: C.muted),
                  ),
                ),
                Text(', AROUND THE BAYWATCH BAYS.', style: T.mono(12, color: C.muted)),
              ],
            ),
            const SizedBox(height: 48),
            Panel(
              radius: 24,
              child: Semantics(
                label:
                    'Map of ${_dots.length} public chargers within $_radiusKm km of the Baywatch bays; the nearest is ${nearest.name}, '
                    '${nearest.distance.round()} metres away. Every one can be booked through Baywatch.',
                child: _DotMap(dots: _dots),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Public chargers (context, grey) and the Baywatch bays (emphasis, violet), projected into a 400×400 view:
/// the bays at the centre, 2 km = 180 units. Tap near a dot to name it.
class _DotMap extends StatefulWidget {
  const _DotMap({required this.dots});
  final List<_Dot> dots;
  @override
  State<_DotMap> createState() => _DotMapState();
}

class _DotMapState extends State<_DotMap> with SingleTickerProviderStateMixin {
  _Dot? _hover;
  late final _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 2400))..repeat();

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      LayoutBuilder(
        builder: (context, box) {
          final w = box.maxWidth;
          final scale = w / 400;
          final h = _hover;
          return GestureDetector(
            onTapDown: (e) {
              // nearest-dot pick: the dots are too dense to aim at one by one
              final p = e.localPosition / scale;
              _Dot? best;
              var bestD = 18.0 * 18;
              for (final d in widget.dots) {
                final dd = math.pow(d.x - p.dx, 2) + math.pow(d.y - p.dy, 2);
                if (dd < bestD) (best, bestD) = (d, dd.toDouble());
              }
              setState(() => _hover = best);
            },
            child: SizedBox(
              width: w,
              height: w,
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  ExcludeSemantics(
                    child: CustomPaint(size: Size.square(w), painter: _DotPainter(widget.dots, h, _pulse)),
                  ),
                  if (h != null)
                    Positioned(
                      left: h.x * scale,
                      top: h.y * scale - 14,
                      child: FractionalTranslation(
                        translation: const Offset(-0.5, -1),
                        child: IgnorePointer(
                          child: Container(
                            constraints: const BoxConstraints(maxWidth: 224),
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                            decoration: BoxDecoration(color: C.ink, borderRadius: BorderRadius.circular(12)),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  h.name,
                                  style: T.body(14, weight: FontWeight.w600, color: Colors.white, height: 1.3),
                                ),
                                Text(
                                  '${h.powerKw > 0 ? '${h.powerKw == h.powerKw.roundToDouble() ? h.powerKw.toInt() : h.powerKw} kW · ' : ''}${formatDistance(h.distance)} from the bay',
                                  style: T.body(14, color: C.onBrandMuted),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          );
        },
      ),
      const SizedBox(height: 16),
      Wrap(
        spacing: 24,
        runSpacing: 8,
        children: [
          for (final (color, label) in [(C.context, 'Public charger, bookable (simulated guard)'), (C.accent, 'Baywatch bays')])
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 10,
                  height: 10,
                  decoration: BoxDecoration(color: color, shape: BoxShape.circle),
                ),
                const SizedBox(width: 8),
                Text(label, style: T.body(14, color: C.muted)),
              ],
            ),
        ],
      ),
    ],
  );
}

class _DotPainter extends CustomPainter {
  _DotPainter(this.dots, this.hover, this.pulse) : super(repaint: pulse);
  final List<_Dot> dots;
  final _Dot? hover;
  final Animation<double> pulse;

  // SVG text: `at` is the baseline; the halo keeps labels readable over the dots
  void _text(Canvas canvas, String s, TextStyle style, Offset at, {bool center = false, bool halo = false}) {
    TextPainter make(TextStyle st) => TextPainter(
      text: TextSpan(text: s, style: st),
      textDirection: TextDirection.ltr,
    )..layout();
    final tp = make(style);
    final o = Offset(center ? at.dx - tp.width / 2 : at.dx, at.dy - tp.computeDistanceToActualBaseline(TextBaseline.alphabetic));
    if (halo) {
      make(
        style.copyWith(
          color: null,
          foreground: Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = 4
            ..color = C.surface,
        ),
      ).paint(canvas, o);
    }
    tp.paint(canvas, o);
  }

  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / 400);
    const c = Offset(200, 200);
    for (final (i, r) in [90.0, 180.0].indexed) {
      canvas.drawPath(
        dashed(Path()..addOval(Rect.fromCircle(center: c, radius: r)), 3, 4),
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1
          ..color = C.context.withValues(alpha: 0.45),
      );
      _text(canvas, '${i + 1} km', T.mono(12, em: 0, color: C.muted), Offset(200, 200 - r - 6), center: true);
    }
    for (final d in dots) {
      canvas.drawCircle(Offset(d.x, d.y), 5, Paint()..color = C.context);
      canvas.drawCircle(
        Offset(d.x, d.y),
        5,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2
          ..color = C.surface,
      );
    }
    final h = hover;
    if (h != null) {
      canvas.drawCircle(
        Offset(h.x, h.y),
        8,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2
          ..color = C.ink,
      );
    }
    // the bays: a pulsing violet pin with a white bolt, like their pins on the app's map
    final t = (pulse.value / 0.8).clamp(0.0, 1.0);
    canvas.drawCircle(c, 16 * (0.6 + 1.3 * t), Paint()..color = C.accent.withValues(alpha: 0.4 * (1 - t)));
    canvas.drawCircle(c, 11, Paint()..color = C.accent);
    canvas.drawCircle(
      c,
      11,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3
        ..color = C.surface,
    );
    canvas.drawPath(
      Path()
        ..moveTo(201.5, 193.5)
        ..lineTo(196.5, 201)
        ..lineTo(199.9, 201)
        ..lineTo(198.5, 206.5)
        ..lineTo(203.5, 198.9)
        ..lineTo(200.1, 198.9)
        ..close(),
      Paint()..color = C.surface,
    );
    _text(canvas, 'Baywatch bays', T.body(15, weight: FontWeight.w700, color: C.ink), const Offset(217, 196), halo: true);
    _text(canvas, 'AT THE VENUE', T.mono(12, weight: FontWeight.w600, em: 0.06, color: C.accent), const Offset(217, 213), halo: true);
  }

  @override
  bool shouldRepaint(_DotPainter old) => old.hover != hover || old.dots != dots;
}
