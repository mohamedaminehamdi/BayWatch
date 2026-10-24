import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../api.dart';
import '../app_state.dart';
import '../format.dart';
import '../theme.dart';
import '../ui.dart';
import 'booking.dart';

// Book any bay: car, day, start block, length, a live quote, accept, pay. The server re-checks everything.
// It opens on "Book now" (this moment, no picking); "Choose a time" brings in the day, start and length.
// web/components/booking/booking-flow.tsx and slot-picker.tsx

/// Opens the booking sheet for [bay]; once booked, the booking's screen
Future<void> showBookingFlow(BuildContext context, Bay bay) async {
  final id = await showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: C.surface,
    barrierColor: C.ink.withValues(alpha: 0.45),
    constraints: const BoxConstraints(maxWidth: 560),
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    builder: (_) => _BookingFlow(bay),
  );
  if (id != null && context.mounted) await openBooking(context, id);
}

// Why the server refused a booking (its messages are in web/lib/schedule.ts), so the flow can say what to do next
enum _Kind { price, car, taken, limit, fault, barrier, slot, other }

final _kinds = <(_Kind, RegExp)>[
  (_Kind.price, RegExp(r'price is now', caseSensitive: false)),
  (_Kind.car, RegExp(r'car is (over the arm|in the bay)|another car is in the bay', caseSensitive: false)),
  (_Kind.taken, RegExp(r'^taken|overlaps', caseSensitive: false)),
  (_Kind.limit, RegExp(r'upcoming bookings', caseSensitive: false)),
  (_Kind.fault, RegExp(r'out of order', caseSensitive: false)),
  (_Kind.barrier, RegExp(r'could not be reserved', caseSensitive: false)),
  (_Kind.slot, RegExp(r'quarter hour|already started|days ahead|at least one|bookings of up to', caseSensitive: false)),
];

typedef _Problem = ({_Kind kind, String message});
_Problem _problemOf(String message) =>
    (kind: _kinds.where((k) => k.$2.hasMatch(message)).map((k) => k.$1).firstOrNull ?? _Kind.other, message: message);
// refusals that a later start fixes
bool _movable(String? message) => message != null && const {_Kind.car, _Kind.taken, _Kind.slot}.contains(_problemOf(message).kind);

const _nearbyDeg = 0.012; // the box searched for free chargers: about 1.3 km each way (east–west widened for Berlin)
const _horizonDays = horizonMs ~/ day;

// Free blocks in a row from index i: the longest booking that can start there
int _freeRun(List<Block> blocks, int i) {
  var n = 0;
  while (i + n < blocks.length && blocks[i + n].state == 'free') {
    n++;
  }
  return n;
}

class _BookingFlow extends StatefulWidget {
  const _BookingFlow(this.initial);
  final Bay initial;
  @override
  State<_BookingFlow> createState() => _BookingFlowState();
}

class _BookingFlowState extends State<_BookingFlow> {
  bool _quick = true; // "Book now"; false once the driver chooses a time
  Bay? _picked; // a free charger nearby that the driver switched to
  Bay? _fresh; // the bay as the server sees it now, fetched on open and after an error
  List<Vehicle>? _cars;
  String _carId = '';
  String _date = ''; // '' is today
  Availability? _avail;
  ({int? start, int blocks}) _slot = (start: null, blocks: 4);
  ({String key, Quote q})? _quote;
  String _acceptedFor = ''; // the price the box was ticked for: a new price needs a new tick
  bool _busy = false;
  String _loadError = '';
  _Problem? _problem;
  String _carSeen = ''; // a bay the server just said a car is standing in
  List<Bay>? _nearby;
  int _reload = 0;
  int _now = DateTime.now().millisecondsSinceEpoch;
  late final Timer _tick;
  Timer? _quoteTimer;
  final _problemKey = GlobalKey();

  // What each load was last started for: a late answer for an older key is dropped (the web's `live` flags)
  String? _bayKey, _availKey, _quoteKey;

  @override
  void initState() {
    super.initState();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) => setState(() => _now = DateTime.now().millisecondsSinceEpoch));
    appState.addListener(_onShell);
    api.vehicles().then(
      (list) {
        if (!mounted) return;
        setState(() {
          _cars = list;
          if (_carId.isEmpty && list.isNotEmpty) _carId = list.first.id;
        });
      },
      onError: (Object e) => mounted ? setState(() => _loadError = '$e') : null,
    );
  }

  @override
  void dispose() {
    _tick.cancel();
    _quoteTimer?.cancel();
    appState.removeListener(_onShell);
    super.dispose();
  }

  void _onShell() => setState(() {});

  // The loads behind the screen, started whenever what they depend on changes (the web's effects)
  void _effects({required String bayId, required bool isReal, required String day, required int? start, required int blocks, required bool asNow}) {
    final bayKey = isReal ? null : '$bayId:$_reload';
    if (bayKey != null && bayKey != _bayKey) {
      _bayKey = bayKey;
      api.bay(bayId).then((b) {
        if (mounted && _bayKey == bayKey) setState(() => _fresh = b);
      }, onError: (_) {});
    }

    final availKey = '$bayId:$day:$_reload';
    if (availKey != _availKey) {
      _availKey = availKey;
      api.availability(bayId, day).then((a) {
        if (mounted && _availKey == availKey) setState(() => _avail = a);
      }, onError: (Object e) {
        if (mounted && _availKey == availKey) setState(() => _loadError = '$e');
      });
    }

    // a fresh quote for every change, a moment after the last one ("Book now": again when the next block begins)
    final quoteKey = start == null ? null : _quoteKeyOf(bayId, asNow, start, blocks);
    if (quoteKey != _quoteKey) {
      _quoteKey = quoteKey;
      _quoteTimer?.cancel();
      if (quoteKey != null) {
        _quoteTimer = Timer(const Duration(milliseconds: 250), () {
          (asNow ? api.quoteNow(bayId) : api.quote(bayId, start!, blocks)).then((q) {
            if (mounted && _quoteKey == quoteKey) setState(() => _quote = (key: quoteKey, q: q));
          }, onError: (Object e) {
            if (mounted && _quoteKey == quoteKey) setState(() => _loadError = '$e');
          });
        });
      }
    }
  }

  String _quoteKeyOf(String bayId, bool asNow, int? start, int blocks) => '$bayId:${asNow ? 'now' : 'at'}:$start:$blocks:$_reload';

  void _startOver() {
    _fresh = null;
    _avail = null;
    _quote = null;
    _acceptedFor = '';
    _problem = null;
    _carSeen = '';
    _nearby = null;
    _loadError = '';
    _bayKey = _availKey = _quoteKey = null;
  }

  // "Book now" on a free charger nearby: the same day, start and length at that bay (from "Book now", its earliest start)
  void _switchTo(Bay b) => setState(() {
        _startOver();
        if (_quick) _slot = (start: null, blocks: _slot.blocks);
        _picked = b;
      });

  Future<void> _findNearby(Bay b) async {
    try {
      final r = await api.bays(south: b.lat - _nearbyDeg, west: b.lng - _nearbyDeg * 1.6, north: b.lat + _nearbyDeg, east: b.lng + _nearbyDeg * 1.6);
      final free = <String, Bay>{
        for (final x in [...r.realBays, ...r.bays])
          if (x.id != b.id && x.green) x.id: x,
      };
      final list = free.values.toList()..sort((x, y) => distanceM(b.point, x.point).compareTo(distanceM(b.point, y.point)));
      if (mounted) setState(() => _nearby = list.take(3).toList());
    } catch (_) {
      if (mounted) setState(() => _nearby = const []);
    }
  }

  Future<void> _book(Bay bay, Quote shown, int start, int blocks, {required bool asNow}) async {
    setState(() {
      _busy = true;
      _problem = null;
    });
    try {
      final r = asNow
          ? await api.reserve(bayId: bay.id, now: true, vehicleId: _carId, priceCents: shown.cents)
          : await api.reserve(bayId: bay.id, start: start, blocks: blocks, vehicleId: _carId, priceCents: shown.cents);
      await appState.refresh();
      if (mounted) Navigator.of(context).pop(r.id);
    } catch (e) {
      if (!mounted) return;
      final p = _problemOf(e is ApiException ? e.message : '$e');
      setState(() {
        _problem = p;
        if (p.kind == _Kind.car) _carSeen = bay.id;
        // the bay, the day and the price again: a new price shows at once, a taken start moves to the next free one
        _reload++;
        _busy = false;
      });
      if (p.kind == _Kind.car || p.kind == _Kind.fault) unawaited(_findNearby(bay));
      // a refusal shows next to the Pay button: bring it into view, wherever the sheet was scrolled to
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final ctx = _problemKey.currentContext;
        if (ctx != null) Scrollable.ensureVisible(ctx, duration: const Duration(milliseconds: 300), alignmentPolicy: ScrollPositionAlignmentPolicy.keepVisibleAtEnd);
      });
    }
  }

  // What to do about a refusal, in the driver's terms
  Widget _nextStep(_Problem p, int? start, Block? next, String? nothingLater) {
    if (_quick && _movable(p.message)) {
      final text = '${next != null ? 'The next start with room is ${formatTime(next.start)}.' : (nothingLater ?? '')}${p.kind == _Kind.car ? ' Or book a free charger nearby.' : ''}';
      return Text(text, style: T.body(15, color: C.ink));
    }
    final text = switch (p.kind) {
      _Kind.price => 'Tick the box to accept the new price, then book.',
      _Kind.car => start != null ? 'We’ve moved your start to ${formatTime(start)}. Book that, or a free charger nearby.' : 'Pick another day, or book a free charger nearby.',
      _Kind.taken => start != null ? 'We’ve moved your start to ${formatTime(start)}, the next free time. Check it, then book again.' : 'Nothing is free on this day any more. Pick another day.',
      _Kind.limit => null,
      _Kind.fault => 'Book a free charger nearby instead.',
      _Kind.barrier => 'Nothing was booked. Wait a minute and try again, or pick a later start.',
      _Kind.slot => 'Pick another start or length, then book again.',
      _Kind.other => 'Nothing was booked. Try again, or pick another start.',
    };
    if (text != null) return Text(text, style: T.body(15, color: C.ink));
    return Align(
      alignment: Alignment.centerLeft,
      child: InkWell(
        onTap: () => goTab(context, AppTab.bookings),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 44),
          child: Center(
            widthFactor: 1,
            child: Text('See your bookings', style: T.body(15, weight: FontWeight.w600, color: C.ink).copyWith(decoration: TextDecoration.underline)),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final now = _now;
    final target = _picked ?? widget.initial;
    final bayId = target.id;
    // the freshest status there is: the shell polls the Baywatch bays every 2 s, the others are fetched
    final bay = appState.state?.realBays.where((b) => b.id == bayId).firstOrNull ?? (_fresh?.id == bayId ? _fresh! : target);
    final today = berlinDate(now);
    final day = _date.isEmpty ? today : _date;
    final carInBay = bay.status == 'occupied' || _carSeen == bay.id;
    final offline = bay.offline;

    // The day as it can be booked now: the server's grid, less the blocks that have started since, and less the
    // starts the guard would have to rise for at once while a car stands in the bay (only "now" is blocked)
    final avail = _avail;
    List<Block>? cells;
    if (avail != null && avail.bayId == bayId && avail.date == day) {
      final first = earliestStart(now);
      cells = [
        for (final b in avail.blocks)
          b.state != 'free'
              ? b
              : b.start < first
                  ? Block(b.start, 'past')
                  : carInBay && b.start - armMs <= now
                      ? Block(b.start, 'occupied')
                      : b,
      ];
    }

    // the picker: the driver's start while it's free, else the next free one (or the day's first); an hour, or what fits
    final pick = cells == null
        ? null
        : cells.where((c) => c.state == 'free' && _slot.start != null && c.start >= _slot.start!).firstOrNull ?? cells.where((c) => c.state == 'free').firstOrNull;
    final fit = cells != null && pick != null ? _freeRun(cells, cells.indexOf(pick)) : 0;
    final maxBlocks = avail?.maxBlocks ?? 16;
    // "Book now": this moment, from the block under way for at least an hour (the server sets the same slot, nowSlot),
    // or the later start the driver moved to
    final asNow = _quick && _slot.start == null;
    final nowS = asNow ? nowSlot(target.cls, now) : null;
    final start = nowS?.start ?? (_quick ? _slot.start : pick?.start);
    final blocks = nowS?.blocks ?? (_quick ? quickLength(target.cls) : math.max(1, math.min(_slot.blocks, math.min(maxBlocks, fit == 0 ? 1 : fit))));
    final firstFree = cells?.where((c) => c.state == 'free').firstOrNull?.start;
    // when that start can't be booked (a car in the bay, a booking or its gap): the next start with room for the length
    Block? next;
    if (_quick && cells != null && start != null) {
      for (var i = 0; i < cells.length && next == null; i++) {
        if (cells[i].start > start && cells[i].state == 'free' && _freeRun(cells, i) >= blocks) next = cells[i];
      }
    }

    _effects(bayId: bayId, isReal: target.real, day: day, start: start, blocks: blocks, asNow: asNow);

    final q = _quote;
    final shown = q != null && q.q.bayId == bayId && start != null ? q.q : null; // the last quote stays, dimmed, while the next loads
    final quoting = start != null && q?.key != _quoteKeyOf(bayId, asNow, start, blocks);
    final priceKey = shown == null ? '' : '${shown.cents}:${shown.payCents}';
    final accepted = priceKey.isNotEmpty && _acceptedFor == priceKey;
    final cars = _cars;
    final problem = _problem;

    // one tap to that next start; the driver still accepts the price and pays
    final moveOn = next != null && !quoting
        ? Align(
            alignment: Alignment.centerLeft,
            child: Btn(
              'Start at ${formatTime(next.start)} instead',
              variant: BtnVariant.secondary,
              onPressed: () => setState(() {
                _slot = (start: next!.start, blocks: _slot.blocks);
                _problem = null;
              }),
            ),
          )
        : null;
    final nothingLater = cells != null && next == null ? 'Nothing later today has room for it. Choose a time on another day.' : null;

    final sections = <Widget>[
      Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
        Text('${classLabel(bay.cls)} · ${bay.kw} kW'.toUpperCase(), style: T.mono(12, color: C.muted)),
        if (bay.guard == 'simulated')
          StatusChip(hardwareNote(bay.guard, bay.real), bg: C.accentTint, fg: C.accent, leading: const Icon(LucideIcons.flaskConical, size: 14, color: C.accent)),
      ]),
      if (offline) Note.text(offlineText, tone: NoteTone.warn, icon: LucideIcons.wifiOff, bold: true),
      if (!_quick && carInBay && day == today)
        Note(
          Text.rich(TextSpan(children: [
            const TextSpan(text: 'A car is in the bay right now,', style: TextStyle(fontWeight: FontWeight.w600)),
            const TextSpan(text: ' so it can’t be booked from now.'),
            if (cells != null) TextSpan(text: firstFree != null ? ' The earliest start today is ${formatTime(firstFree)}.' : ' Pick another day.'),
          ])),
          tone: NoteTone.warn,
          icon: LucideIcons.carFront,
        ),
      if (cars == null && _loadError.isEmpty) const Skeleton(height: 96),
      if (cars != null && cars.isEmpty)
        Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Add the car you’re driving. The camera at the bay uses its plate to let you in.', style: T.body(16, color: C.muted)),
          const SizedBox(height: 20),
          VehicleForm(
            submitLabel: 'Add car and continue',
            onAdded: (v) => setState(() {
              _cars = [v];
              _carId = v.id;
            }),
          ),
        ]),
      if (cars != null && cars.isNotEmpty) ...[
        _CarPicker(cars: cars, value: _carId, onChanged: (id) => setState(() => _carId = id)),
        if (!_quick)
          _DatePicker(
            value: day,
            today: today,
            onChanged: (d) => setState(() {
              _date = d;
              _problem = null;
            }),
          ),
        if (!_quick && cells != null)
          _DayTimeline(
            blocks: cells,
            start: start,
            length: blocks,
            onPick: (s) => setState(() {
              _slot = (start: s, blocks: _slot.blocks);
              _problem = null;
            }),
          )
        else if (!_quick)
          const Skeleton(height: 256),
        if (!_quick && cells != null && start != null)
          _LengthPicker(
            blocks: blocks,
            maxBlocks: maxBlocks,
            fit: fit,
            onChanged: (n) => setState(() {
              _slot = (start: _slot.start ?? start, blocks: n);
              _problem = null;
            }),
          ),
        if (start != null)
          Row(children: [
            Expanded(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                decoration: BoxDecoration(color: C.sunken, borderRadius: BorderRadius.circular(16)),
                child: Semantics(
                  liveRegion: true,
                  child: Text(
                    (asNow
                            ? 'Starts now · until ${formatTime(start + blocks * blockMs)}'
                            : '${dayLabel(day)} · ${formatTime(start)}–${formatTime(start + blocks * blockMs)} · ${formatLength(blocks * blockMs ~/ minute)}')
                        .toUpperCase(),
                    style: T.mono(14, em: 0.06, color: C.ink),
                  ),
                ),
              ),
            ),
            if (_quick) ...[
              const SizedBox(width: 12),
              TextButton(
                onPressed: () => setState(() {
                  _quick = false;
                  _problem = null;
                }),
                style: TextButton.styleFrom(minimumSize: const Size(44, 44), padding: const EdgeInsets.symmetric(horizontal: 4)),
                child: Text('Choose a time', style: T.body(15, weight: FontWeight.w600, color: C.accent).copyWith(decoration: TextDecoration.underline, decorationColor: C.accent)),
              ),
            ],
          ]),
        if (start != null)
          AnimatedOpacity(
            opacity: quoting ? 0.6 : 1,
            duration: const Duration(milliseconds: 150),
            child: shown == null
                ? const Skeleton(height: 160)
                : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    _Price(quote: shown, firstFree: appState.state?.viewer?.firstFree ?? false),
                    const SizedBox(height: 20),
                    if (shown.valid)
                      _quick ? _FeeRules(q: shown, now: now) : CancelSchedule(steps: shown.cancelSchedule, noShowCents: shown.noShowCents, now: now)
                    // with "Book now" a refusal at Pay says the same, next to the button
                    else if (!(_quick && problem != null))
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(color: C.warnTint, borderRadius: BorderRadius.circular(16)),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            const Padding(padding: EdgeInsets.only(top: 1), child: Icon(LucideIcons.triangleAlert, size: 20, color: C.warn)),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Text(shown.reason ?? 'This slot can’t be booked. Pick another start or length.', style: T.body(15, weight: FontWeight.w600, color: C.ink)),
                            ),
                          ]),
                          if (_quick && _movable(shown.reason) && (moveOn != null || nothingLater != null)) ...[
                            const SizedBox(height: 12),
                            moveOn ?? Padding(padding: const EdgeInsets.only(left: 32), child: Text(nothingLater!, style: T.body(15, color: C.ink))),
                          ],
                        ]),
                      ),
                  ]),
          ),
        if (shown != null || problem != null)
          Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            // bw-1 and bw-2 are real locks: booking them really moves the barrier
            if (bay.guard == 'hardware' && (shown?.valid ?? false)) ...[
              Note(
                Text.rich(TextSpan(children: [
                  const TextSpan(text: 'This raises the real barrier at the bay.', style: TextStyle(fontWeight: FontWeight.w600)),
                  if (start != null) TextSpan(text: ' ${barrierNote(start, now)}'),
                ])),
                tone: NoteTone.sunken,
                icon: LucideIcons.construction,
              ),
              const SizedBox(height: 16),
            ],
            if (shown?.valid ?? false) ...[
              ConsentBox(
                plain: true,
                value: accepted,
                onChanged: (v) => setState(() => _acceptedFor = v ? priceKey : ''),
                child: Text('I accept these fees and the cancellation steps', style: T.body(15.5, weight: FontWeight.w500)),
              ),
              const SizedBox(height: 16),
            ],
            if (problem != null) ...[
              Container(
                key: _problemKey,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(color: C.dangerTint, borderRadius: BorderRadius.circular(16)),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Semantics(
                    liveRegion: true,
                    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      const Padding(padding: EdgeInsets.only(top: 1), child: Icon(LucideIcons.triangleAlert, size: 20, color: C.danger)),
                      const SizedBox(width: 12),
                      Expanded(child: Text(problem.message, style: T.body(15, weight: FontWeight.w600, color: C.danger))),
                    ]),
                  ),
                  const SizedBox(height: 6),
                  Padding(padding: const EdgeInsets.only(left: 32), child: _nextStep(problem, start, next, nothingLater)),
                  if (_quick && _movable(problem.message) && moveOn != null) ...[
                    const SizedBox(height: 12),
                    Padding(padding: const EdgeInsets.only(left: 32), child: moveOn),
                  ],
                  if (problem.kind == _Kind.car || problem.kind == _Kind.fault) ...[
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      decoration: BoxDecoration(color: C.surface, borderRadius: BorderRadius.circular(12)),
                      child: _nearby != null
                          ? AlternativeList(bays: _nearby!, from: bay.point, onBook: _switchTo)
                          : Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Text('Looking for free chargers nearby…', style: T.body(15, color: C.muted))),
                    ),
                  ],
                ]),
              ),
              const SizedBox(height: 16),
            ],
            if (shown != null) ...[
              Btn(
                shown.payCents == 0 ? 'Book for free' : 'Pay ${formatEuro(shown.payCents)} and book',
                icon: LucideIcons.creditCard,
                size: BtnSize.lg,
                expand: true,
                loading: _busy,
                onPressed: _carId.isEmpty || !shown.valid || !accepted || quoting || offline ? null : () => _book(bay, shown, start!, blocks, asNow: asNow),
              ),
              const SizedBox(height: 8),
              Text('DEMO PAYMENT: NO CARD IS CHARGED.', textAlign: TextAlign.center, style: T.mono(12, color: C.muted)),
            ],
          ]),
      ],
      if (_loadError.isNotEmpty) ErrorNote(_loadError),
    ];

    return SheetFrame(
      title: 'Book ${bay.name}',
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        for (var i = 0; i < sections.length; i++) ...[if (i > 0) const SizedBox(height: 28), sections[i]],
      ]),
    );
  }
}

class _Price extends StatelessWidget {
  const _Price({required this.quote, required this.firstFree});
  final Quote quote;
  final bool firstFree;
  @override
  Widget build(BuildContext context) {
    final busy = quote.demand == 'Busy' || quote.demand == 'Peak';
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text('Price', style: T.body(16, weight: FontWeight.w600)),
      const SizedBox(height: 8),
      Wrap(spacing: 12, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.end, children: [
        Text(formatEuro(quote.cents), style: T.display(48, height: 1)),
        StatusChip('${quote.demand} demand', bg: busy ? C.warnTint : C.brandTint, fg: busy ? C.warn : C.brandStrong),
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Text('${classLabel(quote.cls)} · ${quote.multiplierText}×'.toUpperCase(), style: T.mono(12, color: C.muted)),
        ),
      ]),
      const SizedBox(height: 8),
      Text(
        'Never more than ${formatEuro(maxReservationCents)}. Fixed once you book. Charging itself is paid at the charger, as usual.',
        style: T.body(14, color: C.muted),
      ),
      if (quote.creditAppliedCents > 0) ...[
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(color: C.brandTint, borderRadius: BorderRadius.circular(16)),
          child: Row(children: [
            Expanded(
              child: Text(firstFree && quote.payCents == 0 ? 'Your first reservation is free' : 'Credit applied', style: T.body(15, weight: FontWeight.w600)),
            ),
            Text('−${formatEuro(quote.creditAppliedCents)}', style: T.mono(15, weight: FontWeight.w600, em: 0, color: C.ink)),
          ]),
        ),
      ],
    ]);
  }
}

// "Book now" keeps the fee rules to three lines; "Choose a time" shows every cancellation step. The arrival grace
// counts from the start, or from booking for a slot already under way (schedule.ts: arriveBy).
class _FeeRules extends StatelessWidget {
  const _FeeRules({required this.q, required this.now});
  final Quote q;
  final int now;
  @override
  Widget build(BuildContext context) {
    final paid = [for (final s in q.cancelSchedule) if (s.percent > 0) s.percent];
    final lo = paid.isEmpty ? 0 : paid.reduce(math.min), hi = paid.isEmpty ? 0 : paid.reduce(math.max);
    final rules = [
      'Free to cancel for ${freeCancelMs ~/ minute} minutes${paid.isNotEmpty ? ', then ${lo == hi ? hi : '$lo–$hi'}% of the fee' : ''}.',
      'Not checked in by ${formatTime(math.max(q.start, now) + arrivalGraceMs)}: the full ${formatEuro(q.noShowCents)} as a no-show.',
      'After ${formatTime(q.end)}: ${idleGraceMs ~/ minute} free minutes to leave, then ${formatEuro(idleCentsPerMin)} a minute, up to ${formatEuro(overstayCapCents)}.',
    ];
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text('Fee rules', style: T.body(16, weight: FontWeight.w600)),
      const SizedBox(height: 8),
      for (final r in rules)
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Padding(padding: const EdgeInsets.fromLTRB(4, 0, 10, 0), child: Text('•', style: T.body(14, color: C.faint))),
            Expanded(child: Text(r, style: T.body(14))),
          ]),
        ),
    ]);
  }
}

class _CarPicker extends StatelessWidget {
  const _CarPicker({required this.cars, required this.value, required this.onChanged});
  final List<Vehicle> cars;
  final String value;
  final ValueChanged<String> onChanged;
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('Which car?', style: T.body(16, weight: FontWeight.w600)),
        const SizedBox(height: 12),
        for (final c in cars) ...[
          Semantics(
            inMutuallyExclusiveGroup: true,
            checked: c.id == value,
            child: Material(
              color: c.id == value ? C.brandTint : C.surface,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
                side: c.id == value ? const BorderSide(color: C.brand, width: 2) : const BorderSide(color: C.lineStrong),
              ),
              child: InkWell(
                borderRadius: BorderRadius.circular(16),
                onTap: () => onChanged(c.id),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(children: [
                    PlateBadge(c.display, size: PlateSize.sm),
                    const SizedBox(width: 16),
                    Expanded(child: Text(c.label, style: T.body(16, weight: FontWeight.w500))),
                    if (c.id == value) const Icon(LucideIcons.check, size: 20, color: C.ink),
                  ]),
                ),
              ),
            ),
          ),
          const SizedBox(height: 8),
        ],
      ]);
}

// A mono-capital choice chip: ink when picked (the date and length choices)
class _Choice extends StatelessWidget {
  const _Choice(this.label, {required this.selected, required this.onTap, this.enabled = true});
  final String label;
  final bool selected, enabled;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Semantics(
        inMutuallyExclusiveGroup: true,
        checked: selected,
        enabled: enabled,
        child: Opacity(
          opacity: enabled ? 1 : 0.45,
          child: Material(
            color: selected ? C.ink : C.surface,
            shape: StadiumBorder(side: BorderSide(color: selected ? C.ink : C.lineStrong)),
            child: InkWell(
              customBorder: const StadiumBorder(),
              onTap: enabled ? onTap : null,
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 44),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Center(
                    widthFactor: 1,
                    child: Text(label.toUpperCase(), style: T.mono(12, weight: FontWeight.w600, em: 0.06, color: selected ? C.onBrand : C.ink)),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
}

// Picking a slot: a date (today up to 60 days ahead), a start block on that day's grid of 96 quarter hours
// (Europe/Berlin), and a length in blocks. The server re-checks all of it when quoting and booking.
class _DatePicker extends StatelessWidget {
  const _DatePicker({required this.value, required this.today, required this.onChanged});
  final String value, today;
  final ValueChanged<String> onChanged;

  DateTime _toDate(String d) => DateTime(int.parse(d.substring(0, 4)), int.parse(d.substring(5, 7)), int.parse(d.substring(8, 10)));
  String _fromDate(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  Future<void> _pick(BuildContext context) async {
    final d = await showDatePicker(
      context: context,
      initialDate: _toDate(value),
      firstDate: _toDate(today),
      lastDate: _toDate(addDays(today, _horizonDays)),
      helpText: 'Another date, up to $_horizonDays days ahead',
      builder: (context, child) => Theme(
        data: Theme.of(context).copyWith(
          datePickerTheme: DatePickerThemeData(
            backgroundColor: C.surface,
            surfaceTintColor: Colors.transparent,
            headerHeadlineStyle: T.display(36, height: 1),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
          ),
        ),
        child: child!,
      ),
    );
    if (d != null) onChanged(_fromDate(d));
  }

  @override
  Widget build(BuildContext context) {
    final tomorrow = addDays(today, 1);
    final other = value != today && value != tomorrow;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text('Which day?', style: T.body(16, weight: FontWeight.w600)),
      const SizedBox(height: 12),
      Wrap(spacing: 8, runSpacing: 8, children: [
        _Choice('Today', selected: value == today, onTap: () => onChanged(today)),
        _Choice('Tomorrow', selected: value == tomorrow, onTap: () => onChanged(tomorrow)),
        Semantics(
          button: true,
          label: 'Another date, up to $_horizonDays days ahead',
          child: Material(
            color: other ? C.ink : C.surface,
            shape: StadiumBorder(side: BorderSide(color: other ? C.ink : C.lineStrong)),
            child: InkWell(
              customBorder: const StadiumBorder(),
              onTap: () => _pick(context),
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 44),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    Icon(LucideIcons.calendar, size: 16, color: other ? C.onBrand : C.ink),
                    const SizedBox(width: 8),
                    Text(dayLabel(value).toUpperCase(), style: T.mono(12, weight: FontWeight.w600, em: 0.06, color: other ? C.onBrand : C.ink)),
                  ]),
                ),
              ),
            ),
          ),
        ),
      ]),
    ]);
  }
}

const _word = {'booked': 'Booked', 'gap': 'Gap', 'past': 'Past', 'mine': 'Yours', 'occupied': 'Occupied'};

// Free blocks are choices; taken ones say why in a word
class _DayTimeline extends StatelessWidget {
  const _DayTimeline({required this.blocks, required this.start, required this.length, required this.onPick});
  final List<Block> blocks;
  final int? start;
  final int length;
  final ValueChanged<int> onPick;

  bool _inRange(Block b) => start != null && b.start >= start! && b.start < start! + length * blockMs;

  Widget _cell(Block b) {
    final minute = ':${formatTime(b.start).substring(3)}';
    Widget body(String word, Color fg, {bool bold = false}) => Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          Text(minute, style: T.mono(11, em: 0, color: fg, weight: bold ? FontWeight.w600 : FontWeight.w500)),
          Text(word.toUpperCase(), style: T.mono(11, em: 0.04, color: fg, weight: bold ? FontWeight.w600 : FontWeight.w500)),
        ]);
    const radius = BorderRadius.all(Radius.circular(8));

    if (b.state != 'free') {
      final word = _word[b.state] ?? b.state;
      final cell = switch (b.state) {
        // hatched: taken by someone else, and visibly not a button
        'booked' => ClipRRect(borderRadius: radius, child: CustomPaint(painter: _Hatch(), child: body(word, C.muted))),
        'gap' => DecoratedBox(decoration: const BoxDecoration(color: C.sunken, borderRadius: radius), child: body(word, C.faint)),
        'mine' => DecoratedBox(
            decoration: BoxDecoration(color: C.accentTint, borderRadius: radius, border: Border.all(color: C.accent.withValues(alpha: 0.3))),
            child: body(word, C.accent),
          ),
        'occupied' => DecoratedBox(decoration: const BoxDecoration(color: C.warnTint, borderRadius: radius), child: body(word, C.warn)),
        _ => Opacity(opacity: 0.6, child: body(word, C.faint)), // past
      };
      return Semantics(label: '${formatTime(b.start)}, $word', excludeSemantics: true, child: SizedBox(height: 44, child: cell));
    }

    final picked = _inRange(b);
    return Semantics(
      label: '${formatTime(b.start)}, free',
      inMutuallyExclusiveGroup: true,
      checked: start == b.start,
      excludeSemantics: true,
      child: Material(
        color: picked ? C.signal : C.surface,
        shape: RoundedRectangleBorder(borderRadius: radius, side: BorderSide(color: picked ? C.ink : C.lineStrong)),
        child: InkWell(
          borderRadius: radius,
          onTap: () => onPick(b.start),
          child: SizedBox(
            height: 44,
            child: body(picked ? (start == b.start ? 'Start' : '·') : 'Free', C.ink, bold: picked),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final rows = <List<Block>>[];
    for (var h = 0; h * 4 < blocks.length; h++) {
      final row = blocks.sublist(h * 4, math.min(h * 4 + 4, blocks.length));
      if (row.any((b) => b.state != 'past')) rows.add(row); // hours that are entirely over are left out
    }
    if (rows.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: C.sunken, borderRadius: BorderRadius.circular(16)),
        child: Text('This day is over. Pick another date.', style: T.body(16, color: C.muted)),
      );
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text('Start time', style: T.body(16, weight: FontWeight.w600)),
      const SizedBox(height: 8),
      for (final row in rows)
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Row(children: [
            SizedBox(width: 52, child: ExcludeSemantics(child: Text(formatTime(row.first.start), style: T.mono(12, em: 0, color: C.muted)))),
            for (var i = 0; i < 4; i++) ...[
              if (i > 0) const SizedBox(width: 6),
              Expanded(child: i < row.length ? _cell(row[i]) : const SizedBox.shrink()),
            ],
          ]),
        ),
    ]);
  }
}

class _Hatch extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = C.sunken);
    final p = Paint()
      ..color = C.line
      ..strokeWidth = 2;
    for (var x = -size.height; x < size.width; x += 11) {
      canvas.drawLine(Offset(x, size.height), Offset(x + size.height, 0), p);
    }
  }

  @override
  bool shouldRepaint(_) => false;
}

// Length in blocks: 1–4 h presets within the class maximum, plus ±15 min. `fit` is the free run from the start.
class _LengthPicker extends StatelessWidget {
  const _LengthPicker({required this.blocks, required this.maxBlocks, required this.fit, required this.onChanged});
  final int blocks, maxBlocks, fit;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final limit = math.max(1, math.min(maxBlocks, fit));
    final presets = [4, 8, 12, 16].where((n) => n <= maxBlocks);
    String len(int n) => formatLength(n * blockMs ~/ minute);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text('How long?', style: T.body(16, weight: FontWeight.w600)),
      Text('Up to ${len(maxBlocks)} at this charger.', style: T.body(14, color: C.muted)),
      const SizedBox(height: 12),
      Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
        for (final n in presets) _Choice('${n ~/ 4} h', selected: blocks == n, enabled: n <= limit, onTap: () => onChanged(n)),
        Container(
          decoration: ShapeDecoration(shape: StadiumBorder(side: BorderSide(color: C.lineStrong))),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            IconButton(
              tooltip: '15 minutes shorter',
              onPressed: blocks <= 1 ? null : () => onChanged(blocks - 1),
              icon: const Icon(LucideIcons.minus, size: 16),
              style: IconButton.styleFrom(minimumSize: const Size.square(44), foregroundColor: C.ink),
            ),
            ConstrainedBox(
              constraints: const BoxConstraints(minWidth: 88),
              child: Semantics(liveRegion: true, child: Text(len(blocks), textAlign: TextAlign.center, style: T.mono(14, weight: FontWeight.w600, em: 0, color: C.ink))),
            ),
            IconButton(
              tooltip: '15 minutes longer',
              onPressed: blocks >= limit ? null : () => onChanged(blocks + 1),
              icon: const Icon(LucideIcons.plus, size: 16),
              style: IconButton.styleFrom(minimumSize: const Size.square(44), foregroundColor: C.ink),
            ),
          ]),
        ),
      ]),
      if (fit < maxBlocks && fit > 0) ...[
        const SizedBox(height: 8),
        Text('The bay is taken after ${len(fit)} from this start.', style: T.body(14, color: C.muted)),
      ],
    ]);
  }
}
