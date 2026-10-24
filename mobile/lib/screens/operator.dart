import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../api.dart';
import '../app_state.dart';
import '../format.dart';
import '../theme.dart';
import '../ui.dart';

// The operator dashboard (Bay Guard): every Baywatch bay live, the blocked-bay alerts, the last 7 days and the
// event log. web/components/operator/dashboard.tsx and week-chart.tsx; the data is web/lib/server.ts operatorData().

const _cpoShare = 0.7; // of reservation revenue (web/lib/pricing.ts CPO_SHARE)

int _i(Object? v) => (v as num?)?.toInt() ?? 0;
int? _io(Object? v) => (v as num?)?.toInt();
double? _do(Object? v) => (v as num?)?.toDouble();
List<Map<String, dynamic>> _maps(Object? v) => [
  for (final x in (v as List? ?? const [])) x as Map<String, dynamic>,
];

// ── the data (no shared models: only this screen reads it) ──

class _Hardware {
  _Hardware.fromJson(Map<String, dynamic> j)
    : state = j['state'] as String? ?? 'unknown',
      mock = j['mock'] == true,
      lockId = j['lockId'] as String?,
      online = j['online'] as bool?,
      carPresence = j['carPresence'] as String?,
      autoUnlock = j['autoUnlock'] as String?,
      battery12V = _do(j['battery12V']),
      signal = _io(j['signalStrength4G']),
      water = j['waterIngress'] as bool?,
      errors = [for (final e in (j['activeErrors'] as List? ?? const [])) '$e'],
      lastSeenAt = j['lastSeenAt'] as String?,
      events = j['events'] == true,
      stale = j['stale'] == true,
      error = j['error'] as String?,
      updatedAt = _io(j['updatedAt']);
  final String state; // free (arm down) | blocked (arm up) | unknown
  final bool mock, events, stale;
  final String? lockId, carPresence, autoUnlock, lastSeenAt, error;
  final bool? online, water;
  final double? battery12V;
  final int? signal, updatedAt;
  final List<String> errors;
}

// What the hardware panel shows for one lock (web/lib/operator.ts hardwarePanel)
({
  String guard,
  bool online,
  List<String> warnings,
  List<(String, String)> rows,
})
_hardwarePanel(_Hardware hw, bool inSession) {
  final guard = hw.state == 'unknown'
      ? 'unknown'
      : hw.state == 'blocked'
      ? 'up'
      : 'down';
  final warnings = [
    if (hw.autoUnlock == 'any')
      'The camera lowers the arm for any car: the hold isn’t enforced.',
    if (!hw.mock && hw.state == 'free' && !inSession)
      'The arm is down with nobody checked in: the bay isn’t guarded.',
  ];
  final seen = hw.lastSeenAt == null
      ? null
      : DateTime.tryParse(hw.lastSeenAt!)?.millisecondsSinceEpoch;
  final rows = hw.mock
      ? <(String, String)>[]
      : [
          ('Lock', hw.lockId ?? '–'),
          ('Car sensor', hw.carPresence ?? '–'),
          ('Live events', hw.events ? 'on' : 'off'),
          (
            '12 V battery',
            hw.battery12V == null
                ? '–'
                : '${hw.battery12V!.toStringAsFixed(1)} V',
          ),
          ('Signal', hw.signal == null ? '–' : '${hw.signal}'),
          (
            'Water',
            hw.water == null
                ? '–'
                : hw.water!
                ? 'detected'
                : 'dry',
          ),
          ('Errors', hw.errors.isNotEmpty ? hw.errors.join(', ') : 'none'),
          ('Last seen', seen == null ? '–' : formatTime(seen)),
          if (hw.stale)
            (
              'Reading',
              'stale since ${hw.updatedAt != null ? formatTime(hw.updatedAt!) : 'the start'}: ${hw.error ?? 'no answer'}',
            ),
        ];
  return (
    guard: guard,
    online: hw.online != false,
    warnings: warnings,
    rows: rows,
  );
}

class _LiveBay {
  _LiveBay.fromJson(Map<String, dynamic> j)
    : bay = Bay.fromJson(j['bay'] as Map<String, dynamic>),
      lockId = j['lockId'] as String?,
      hardware = _Hardware.fromJson(
        j['hardware'] as Map<String, dynamic>? ?? const {},
      ),
      blockedSince = _io(j['blockedSince']),
      booking = j['booking'] == null
          ? null
          : _Snap.fromJson(j['booking'] as Map<String, dynamic>);
  final Bay bay;
  final String? lockId;
  final _Hardware hardware;
  final int? blockedSince;
  final _Snap? booking;
}

// The booking that matters at a bay right now: in it, live on it, or the next one
class _Snap {
  _Snap.fromJson(Map<String, dynamic> j)
    : status = j['status'] as String,
      start = _i(j['start']),
      end = _i(j['end']),
      arriveBy = _i(j['arriveBy']),
      blockedSince = _io(j['blockedSince']);
  final String status;
  final int start, end, arriveBy;
  final int? blockedSince;
}

class _Alert {
  _Alert.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      bayId = j['bayId'] as String,
      since = _i(j['since']),
      plate = j['plate'] as String?,
      status = j['status'] as String,
      resolvedAt = _io(j['resolvedAt']),
      resolvedBy = j['resolvedBy'] as String?,
      emailStatus = j['emailStatus'] as String? ?? 'pending',
      simulated = j['simulated'] == true;
  final String id, bayId, status, emailStatus;
  final int since;
  final int? resolvedAt;
  final String? plate,
      resolvedBy; // the plate is for operators only, erased on resolve
  final bool simulated;
}

class _Day {
  _Day.fromJson(Map<String, dynamic> j)
    : day = j['day'] as String,
      total = _i(j['total']),
      completed = _i(j['completed']),
      noShow = _i(j['noShow']),
      cancelled = _i(j['cancelled']);
  final String day; // YYYY-MM-DD
  final int total, completed, noShow, cancelled;
}

class _Kpis {
  _Kpis.fromJson(Map<String, dynamic> j)
    : reservations = _i(j['reservations']),
      walkups = _i(j['walkups']),
      ended = _i(j['ended']),
      completionRate = _do(j['completionRate']),
      noShowRate = _do(j['noShowRate']),
      avgArriveMs = _do(j['avgArriveMs']),
      blockedIncidents = _i(j['blockedIncidents']),
      blockedMinutes = _i(j['blockedMinutes']),
      cameraCheckIns = _i(j['cameraCheckIns']),
      fallbackCheckIns = _i(j['fallbackCheckIns']),
      fuzzyMatches = _i(j['fuzzyMatches']),
      revenueCents = _i(j['revenueCents']),
      overstayCents = _i(j['overstayCents']),
      overstayOperatorCents = _i(
        (j['overstaySplit'] as Map?)?['operatorCents'],
      ),
      overstayPlatformCents = _i(
        (j['overstaySplit'] as Map?)?['platformCents'],
      ),
      creditsIssuedCents = _i(j['creditsIssuedCents']),
      creditsUsedCents = _i(j['creditsUsedCents']),
      cpoShareCents = _i(j['cpoShareCents']);
  final int reservations,
      walkups,
      ended,
      blockedIncidents,
      blockedMinutes,
      cameraCheckIns,
      fallbackCheckIns,
      fuzzyMatches;
  final int revenueCents,
      overstayCents,
      overstayOperatorCents,
      overstayPlatformCents,
      creditsIssuedCents,
      creditsUsedCents,
      cpoShareCents;
  final double? completionRate, noShowRate, avgArriveMs;
}

class _BayStat {
  _BayStat.fromJson(Map<String, dynamic> j)
    : bayId = j['bayId'] as String,
      reservations = _i(j['reservations']),
      completed = _i(j['completed']),
      noShows = _i(j['noShows']),
      walkups = _i(j['walkups']),
      revenueCents = _i(j['revenueCents']);
  final String bayId;
  final int reservations, completed, noShows, walkups, revenueCents;
}

class _Data {
  _Data.fromJson(Map<String, dynamic> j)
    : simulator = j['simulator'] == true,
      bays = [for (final b in _maps(j['bays'])) _LiveBay.fromJson(b)],
      alerts = [for (final a in _maps(j['alerts'])) _Alert.fromJson(a)],
      log = [
        for (final l in _maps(j['log']))
          (
            at: _i(l['at']),
            type: l['type'] as String? ?? '',
            detail: l['detail'] as String? ?? '',
          ),
      ],
      days = [
        for (final d in _maps((j['stats'] as Map)['days'])) _Day.fromJson(d),
      ],
      simulated = (j['stats'] as Map)['simulated'] == true,
      kpis = _Kpis.fromJson(
        (j['stats'] as Map)['kpis'] as Map<String, dynamic>,
      ),
      statBays = [
        for (final b in _maps((j['stats'] as Map)['bays']))
          _BayStat.fromJson(b),
      ];
  final bool simulator, simulated;
  final List<_LiveBay> bays;
  final List<_Alert> alerts;
  final List<({int at, String type, String detail})> log;
  final List<_Day> days;
  final _Kpis kpis;
  final List<_BayStat> statBays;
}

/// GET /api/operator, parsed; for test/operator_test.dart (the shape comes from the engine, test/fixtures/operator.json)
@visibleForTesting
({int bays, int openAlerts, int days, int reservations, int logLines})
parseOperatorForTest(Map<String, dynamic> j) {
  final d = _Data.fromJson(j);
  return (
    bays: d.bays.length,
    openAlerts: d.alerts.where((a) => a.status == 'open').length,
    days: d.days.length,
    reservations: d.kpis.reservations,
    logLines: d.log.length,
  );
}

// ── formatting ──

String _percent(double? x) => x == null ? '–' : '${(x * 100).round()}%';
String _minutes(int? ms) =>
    ms == null ? '–' : '${math.max(1, (ms / minute).round())} min';
// arrivals against the booked start: "+4 min" late, "3 min early"
String _arrival(double? ms) => ms == null
    ? '–'
    : ms < 0
    ? '${(-ms / minute).round()} min early'
    : '+${(ms / minute).round()} min';

const _email = {
  'sent': (
    icon: LucideIcons.mailCheck,
    label: 'Email sent',
    tone: C.brandStrong,
  ),
  'pending': (icon: LucideIcons.mail, label: 'Sending email…', tone: C.muted),
  'skipped': (
    icon: LucideIcons.mailWarning,
    label: 'Email skipped: no Resend key set',
    tone: C.warn,
  ),
  'failed': (
    icon: LucideIcons.mailX,
    label: 'Email failed: see server log',
    tone: C.danger,
  ),
};

// ── the screen ──

class OperatorScreen extends StatefulWidget {
  const OperatorScreen({super.key});
  @override
  State<OperatorScreen> createState() => _OperatorScreenState();
}

class _OperatorScreenState extends State<OperatorScreen> {
  _Data? _data;
  String _error = '';
  String? _busy;
  late final Timer _poll;

  @override
  void initState() {
    super.initState();
    _load();
    // polled only while this tab is showing
    _poll = Timer.periodic(const Duration(seconds: 3), (_) {
      if (currentTab.value == AppTab.operator) _load();
    });
    currentTab.addListener(_onTab);
  }

  void _onTab() {
    if (currentTab.value == AppTab.operator) _load();
  }

  @override
  void dispose() {
    _poll.cancel();
    currentTab.removeListener(_onTab);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = _Data.fromJson(
        await api.get('/api/operator') as Map<String, dynamic>,
      );
      if (!mounted) return;
      setState(() {
        _data = d;
        _error = '';
      });
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  Future<void> _run(String key, Future<void> Function() fn) async {
    setState(() => _busy = key);
    try {
      await fn();
      await _load();
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
    if (mounted) setState(() => _busy = null);
  }

  String _bayName(String id) =>
      _data?.bays.where((b) => b.bay.id == id).firstOrNull?.bay.name ?? id;

  void _confirmLower(String bayId) {
    var lowering = false;
    showSheet<void>(
      context,
      title: 'Lower the arm of ${_bayName(bayId)}?',
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Any car can then park in the bay.', style: T.body(18)),
            const SizedBox(height: 8),
            Text(
              'For a driver who can’t get in, or after a command timed out. A booking in progress isn’t changed.',
              style: T.body(16, color: C.muted),
            ),
            const SizedBox(height: 24),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [
                Btn(
                  'Lower the arm',
                  size: BtnSize.lg,
                  loading: lowering,
                  onPressed: () async {
                    setSheet(() => lowering = true);
                    final nav = Navigator.of(ctx);
                    await _run(
                      'lower',
                      () => api.post('/api/operator/hardware/lower', {
                        'bayId': bayId,
                      }),
                    );
                    nav.pop();
                  },
                ),
                Btn(
                  'Not now',
                  variant: BtnVariant.secondary,
                  size: BtnSize.lg,
                  onPressed: () => Navigator.of(ctx).pop(),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    if (d == null) {
      return ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (_error.isNotEmpty) ...[
            ErrorNote(_error),
            const SizedBox(height: 16),
          ],
          const Skeleton(height: 512, radius: 24),
        ],
      );
    }
    return NowBuilder(
      builder: (context, now) {
        final open = d.alerts.where((a) => a.status == 'open').toList();
        final resolved = d.alerts
            .where((a) => a.status == 'resolved' && !a.simulated)
            .take(3)
            .toList();
        final k = d.kpis;
        final checkIns = k.cameraCheckIns + k.fallbackCheckIns;
        return SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 32, 20, 40),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 720),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const SectionLabel('Bay Guard'),
                  const SizedBox(height: 4),
                  Text('Operator dashboard', style: T.display(40)),
                  const SizedBox(height: 4),
                  Text(
                    '${d.bays.length} Baywatch bays · ${d.bays.firstOrNull?.bay.address ?? ''} · last 7 days',
                    style: T.body(16, color: C.muted),
                  ),
                  if (d.simulated || d.simulator) ...[
                    const SizedBox(height: 16),
                    Wrap(
                      spacing: 12,
                      runSpacing: 12,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        // demo-only data is violet, like every other backstage control
                        if (d.simulated)
                          const StatusChip(
                            'Includes simulated data',
                            bg: C.accentTint,
                            fg: C.accent,
                            leading: Icon(
                              LucideIcons.flaskConical,
                              size: 16,
                              color: C.accent,
                            ),
                          ),
                        if (d.simulator)
                          Btn(
                            'Simulate a week',
                            icon: LucideIcons.flaskConical,
                            variant: BtnVariant.secondary,
                            loading: _busy == 'simulate',
                            onPressed: () => _run(
                              'simulate',
                              () => api.post('/api/operator/simulate'),
                            ),
                          ),
                      ],
                    ),
                  ],
                  if (_error.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    ErrorNote(_error),
                  ],
                  const SizedBox(height: 32),

                  // alerts
                  Wrap(
                    spacing: 12,
                    runSpacing: 8,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(
                        'Blocked-bay alerts',
                        style: T.display(30, height: 1),
                      ),
                      if (open.isNotEmpty)
                        StatusChip(
                          '${open.length} open',
                          bg: C.warn,
                          fg: Colors.white,
                        ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  for (final a in open) ...[
                    _OpenAlert(
                      a: a,
                      bayName: _bayName(a.bayId),
                      now: now,
                      busy: _busy == a.id,
                      onClear: () => _run(
                        a.id,
                        () => api.post('/api/operator/alerts/${a.id}/resolve'),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (open.isEmpty)
                    Panel(
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(
                            LucideIcons.circleCheck,
                            size: 24,
                            color: C.brand,
                          ),
                          const SizedBox(width: 16),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'No open alerts',
                                  style: T.body(16, weight: FontWeight.w600),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  'When a car without a booking stands in a booked bay, it shows up here and operators get an email.',
                                  style: T.body(15, color: C.muted),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  if (resolved.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    for (final a in resolved)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: Text(
                          '${_bayName(a.bayId)}: resolved at ${formatTime(a.resolvedAt ?? a.since)} by ${a.resolvedBy == 'operator' ? 'an operator' : 'the bay (the car left)'}, after '
                          '${_minutes((a.resolvedAt ?? a.since) - a.since)}. Plate deleted.',
                          style: T.body(14, color: C.muted),
                        ),
                      ),
                  ],
                  const SizedBox(height: 24),

                  // on phones the live bays come right after the alerts
                  for (final b in d.bays) ...[
                    _LiveBayCard(b: b, now: now, onLower: _confirmLower),
                    const SizedBox(height: 16),
                  ],
                  const SizedBox(height: 8),

                  Text('The last 7 days', style: T.display(30, height: 1)),
                  const SizedBox(height: 12),
                  _TileGrid(
                    tiles: [
                      (
                        'Reservations',
                        '${k.reservations}',
                        '${k.ended} finished · ${k.walkups} walk-ups',
                      ),
                      (
                        'Completed',
                        _percent(k.completionRate),
                        'of finished bookings',
                      ),
                      (
                        'No-shows',
                        _percent(k.noShowRate),
                        'the whole fee kept',
                      ),
                      (
                        'Arrival',
                        _arrival(k.avgArriveMs),
                        'against the booked start, on average',
                      ),
                      (
                        'Blocked incidents',
                        '${k.blockedIncidents}',
                        '${k.blockedMinutes} min blocked in total',
                      ),
                      (
                        'Checked in by camera',
                        _percent(
                          checkIns == 0 ? null : k.cameraCheckIns / checkIns,
                        ),
                        '${k.fallbackCheckIns} at the bay without it · ${k.fuzzyMatches} misreads matched',
                      ),
                      (
                        'Credits issued',
                        formatEuro(k.creditsIssuedCents),
                        '€5 per blocked bay · ${formatEuro(k.creditsUsedCents)} used, free first bookings included',
                      ),
                      (
                        'Idle fees',
                        formatEuro(k.overstayCents),
                        '${formatEuro(k.overstayOperatorCents)} to you, ${formatEuro(k.overstayPlatformCents)} to the platform',
                      ),
                      (
                        'Your revenue share',
                        formatEuro(k.cpoShareCents),
                        '${(_cpoShare * 100).round()}% of reservation fees and half the idle fees, of ${formatEuro(k.revenueCents)}',
                      ),
                    ],
                  ),
                  if (d.statBays.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    for (final b in d.statBays)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: Text.rich(
                          TextSpan(
                            children: [
                              TextSpan(
                                text: _bayName(b.bayId),
                                style: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                  color: C.ink,
                                ),
                              ),
                              TextSpan(
                                text:
                                    ': ${b.reservations} bookings, ${b.completed} completed, ${b.noShows} no-shows, ${b.walkups} walk-ups · ${formatEuro(b.revenueCents)}',
                              ),
                            ],
                          ),
                          style: T.body(14, color: C.muted),
                        ),
                      ),
                  ],
                  const SizedBox(height: 24),

                  Panel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          'Reservations per day',
                          style: T.display(30, height: 1),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Tap a day for the breakdown.',
                          style: T.body(14, color: C.muted),
                        ),
                        const SizedBox(height: 16),
                        _WeekChart(days: d.days),
                      ],
                    ),
                  ),
                  const SizedBox(height: 24),

                  Panel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text('Event log', style: T.display(24, height: 1)),
                        const SizedBox(height: 12),
                        ConstrainedBox(
                          constraints: const BoxConstraints(maxHeight: 384),
                          child: d.log.isEmpty
                              ? Text(
                                  'Nothing has happened at the bay yet.',
                                  style: T.body(14, color: C.muted),
                                )
                              : ListView.separated(
                                  shrinkWrap: true,
                                  itemCount: d.log.length,
                                  separatorBuilder: (_, _) =>
                                      const SizedBox(height: 8),
                                  itemBuilder: (_, i) {
                                    final l = d.log[i];
                                    return Row(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          formatTime(l.at),
                                          style: T.mono(
                                            14,
                                            em: 0,
                                            color: C.muted,
                                          ),
                                        ),
                                        const SizedBox(width: 12),
                                        Expanded(
                                          child: Text.rich(
                                            TextSpan(
                                              children: [
                                                TextSpan(
                                                  text: l.type
                                                      .replaceAll('_', ' ')
                                                      .toUpperCase(),
                                                  style: T.mono(
                                                    12,
                                                    weight: FontWeight.w600,
                                                    color: C.ink,
                                                  ),
                                                ),
                                                if (l.detail.isNotEmpty)
                                                  TextSpan(
                                                    text: ' · ${l.detail}',
                                                    style: T.body(
                                                      14,
                                                      color: C.muted,
                                                    ),
                                                  ),
                                              ],
                                            ),
                                          ),
                                        ),
                                      ],
                                    );
                                  },
                                ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class _OpenAlert extends StatelessWidget {
  const _OpenAlert({
    required this.a,
    required this.bayName,
    required this.now,
    required this.busy,
    required this.onClear,
  });
  final _Alert a;
  final String bayName;
  final int now;
  final bool busy;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final mail = _email[a.emailStatus] ?? _email['pending']!;
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: C.warnTint,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(LucideIcons.triangleAlert, size: 20, color: C.warn),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '$bayName: a car without a booking is in the booked bay',
                  style: T.body(16, weight: FontWeight.w600, color: C.warn),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text.rich(
            TextSpan(
              children: [
                TextSpan(text: 'Since ${formatTime(a.since)} · '),
                TextSpan(
                  text: formatCountdown(now - a.since),
                  style: T.mono(18, weight: FontWeight.w600, em: 0),
                ),
                const TextSpan(
                  text: ' and counting. The driver’s arrival deadline waits, and they got a €5 credit.',
                ),
              ],
            ),
            style: T.body(18),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 16,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              if (a.plate != null) PlateBadge(a.plate!, size: PlateSize.sm),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(mail.icon, size: 16, color: mail.tone),
                  const SizedBox(width: 6),
                  Text(
                    mail.label,
                    style: T.body(
                      14,
                      weight: FontWeight.w500,
                      color: mail.tone,
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 16),
          Btn(
            'Bay is clear',
            icon: LucideIcons.circleCheck,
            size: BtnSize.lg,
            loading: busy,
            onPressed: onClear,
          ),
          const SizedBox(height: 8),
          Text(
            'The booking carries on, and the plate is deleted.',
            style: T.body(14, color: C.muted),
          ),
        ],
      ),
    );
  }
}

// One Baywatch bay, live: what's happening there, and its lock (if it has one)
class _LiveBayCard extends StatelessWidget {
  const _LiveBayCard({
    required this.b,
    required this.now,
    required this.onLower,
  });
  final _LiveBay b;
  final int now;
  final ValueChanged<String> onLower;

  @override
  Widget build(BuildContext context) {
    final r = b.booking;
    final (status, detail) = b.blockedSince != null
        ? (
            r?.blockedSince != null ? 'Blocked' : 'Car in the bay',
            '${r?.blockedSince != null ? 'A car without this booking' : 'No booking'}, since ${formatTime(b.blockedSince!)} (${formatCountdown(now - b.blockedSince!)})',
          )
        : switch (r?.status) {
            'live' => (
              'Booked: arriving',
              'Arrive by ${formatTime(r!.arriveBy)}, session until ${formatTime(r.end)}',
            ),
            'upcoming' => (
              'Free until the next booking',
              'Next booking ${formatTime(r!.start)}–${formatTime(r.end)}',
            ),
            'arrived' => (
              'Driver checked in',
              'Guard down, session until ${formatTime(r!.end)}',
            ),
            'charging' => (
              'Charging',
              'Booked session until ${formatTime(r!.end)}',
            ),
            'walkup' => (
              'Walk-up',
              'Unlocked at the bay, free until ${formatTime(r!.end)}',
            ),
            _ => ('Free', 'Guarded, bookable, and open for walk-up'),
          };
    final inSession = const {
      'arrived',
      'charging',
      'walkup',
    }.contains(r?.status);
    final hw = b.lockId != null ? _hardwarePanel(b.hardware, inSession) : null;
    final muted = T.mono(12, color: C.onBrandMuted);

    return Semantics(
      label: 'Live: ${b.bay.name}',
      child: Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: C.brandDeep,
          borderRadius: BorderRadius.circular(24),
        ),
        child: DefaultTextStyle.merge(
          style: T.body(16, color: C.onBrand),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const LiveDot(color: C.mint, size: 10),
                  const SizedBox(width: 8),
                  Flexible(
                    child: Text(
                      'LIVE · ${b.bay.name.toUpperCase()}',
                      style: T.mono(
                        12,
                        weight: FontWeight.w600,
                        em: 0.1,
                        color: C.onBrandMuted,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text(status, style: T.display(40, color: C.onBrand, height: 0.9)),
              const SizedBox(height: 8),
              Text(detail),
              const SizedBox(height: 20),
              Container(
                padding: const EdgeInsets.only(top: 16),
                decoration: BoxDecoration(
                  border: Border(
                    top: BorderSide(
                      color: Colors.white.withValues(alpha: 0.14),
                    ),
                  ),
                ),
                child: Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    const Icon(
                      LucideIcons.shieldCheck,
                      size: 16,
                      color: C.mint,
                    ),
                    if (hw == null)
                      Text(
                        'NO HARDWARE ASSIGNED YET · SIMULATED GUARD',
                        style: muted,
                      )
                    else ...[
                      Text(
                        'GUARD ${hw.guard.toUpperCase()} · ${b.lockId!.toUpperCase()}${b.hardware.mock ? ' · MOCK HARDWARE' : ''}',
                        style: muted,
                      ),
                      if (!b.hardware.mock)
                        hw.online
                            ? StatusChip(
                                'Online',
                                bg: C.mint.withValues(alpha: 0.15),
                                fg: C.mint,
                              )
                            : const StatusChip(
                                'Offline',
                                bg: C.danger,
                                fg: Colors.white,
                              ),
                    ],
                  ],
                ),
              ),
              if (hw != null)
                for (final w in hw.warnings) ...[
                  const SizedBox(height: 12),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: C.warnTint,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Padding(
                          padding: EdgeInsets.only(top: 2),
                          child: Icon(
                            LucideIcons.triangleAlert,
                            size: 16,
                            color: C.warn,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            w,
                            style: T.body(
                              14,
                              weight: FontWeight.w500,
                              color: C.warn,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              if (hw != null && hw.rows.isNotEmpty) ...[
                const SizedBox(height: 16),
                LayoutBuilder(
                  builder: (context, box) => Wrap(
                    runSpacing: 10,
                    children: [
                      for (final (k, v) in hw.rows)
                        SizedBox(
                          width: k == 'Reading'
                              ? box.maxWidth
                              : box.maxWidth / 2,
                          child: Padding(
                            padding: const EdgeInsets.only(right: 16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(k.toUpperCase(), style: muted),
                                Text(v, style: T.body(14, color: C.onBrand)),
                              ],
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ],
              if (hw != null) ...[
                const SizedBox(height: 20),
                Btn(
                  'Lower the arm',
                  icon: LucideIcons.arrowDownToLine,
                  variant: BtnVariant.onBrand,
                  size: BtnSize.sm,
                  onPressed: () => onLower(b.bay.id),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

typedef _Tile = (String label, String value, String context);

// The KPI tiles, two to a row, each row as tall as its tallest tile
class _TileGrid extends StatelessWidget {
  const _TileGrid({required this.tiles});
  final List<_Tile> tiles;

  Widget _tile(_Tile t) => Panel(
    padding: const EdgeInsets.all(16),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(t.$1.toUpperCase(), style: T.mono(12, color: C.muted, em: 0.1)),
        const SizedBox(height: 8),
        Text(t.$2, style: T.display(30, height: 1)),
        const SizedBox(height: 6),
        Text(t.$3, style: T.body(14, color: C.muted)),
      ],
    ),
  );

  @override
  Widget build(BuildContext context) => Column(
    children: [
      for (var i = 0; i < tiles.length; i += 2)
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: _tile(tiles[i])),
                const SizedBox(width: 12),
                Expanded(
                  child: i + 1 < tiles.length
                      ? _tile(tiles[i + 1])
                      : const SizedBox.shrink(),
                ),
              ],
            ),
          ),
        ),
    ],
  );
}

// ── reservations per day: a single series, so no legend (the heading names it) ──

const _chartH = 240.0;
const _padL = 36.0, _padR = 8.0, _padT = 18.0, _padB = 30.0;
const _barMax = 24.0; // column width cap, per the dataviz spec

String _weekday(String day) => dayLabel(day).split(' ').first;

// 1, 2 or 5 × 10^n: clean axis ticks
double _niceStep(double raw) {
  final p = math.pow(10, (math.log(raw) / math.ln10).floor()).toDouble();
  return [
    1,
    2,
    5,
    10,
  ].map((m) => m * p).firstWhere((s) => s >= raw, orElse: () => 10 * p);
}

class _WeekChart extends StatefulWidget {
  const _WeekChart({required this.days});
  final List<_Day> days;
  @override
  State<_WeekChart> createState() => _WeekChartState();
}

class _WeekChartState extends State<_WeekChart> {
  int? _hover;

  @override
  Widget build(BuildContext context) {
    final days = widget.days;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        LayoutBuilder(
          builder: (context, box) {
            final width = math.max(280.0, box.maxWidth);
            final geo = _Geometry(days, width);
            final h = _hover == null || _hover! >= days.length
                ? null
                : days[_hover!];
            return Semantics(
              label:
                  'Reservations per day: ${days.map((d) => '${dayLabel(d.day)} ${d.total}').join(', ')}',
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTapDown: (e) {
                  final i = ((e.localPosition.dx - _padL) / geo.band).floor();
                  setState(
                    () => _hover = i < 0 || i >= days.length || i == _hover
                        ? null
                        : i,
                  );
                },
                child: SizedBox(
                  width: width,
                  height: _chartH,
                  child: Stack(
                    clipBehavior: Clip.none,
                    children: [
                      CustomPaint(
                        size: Size(width, _chartH),
                        painter: _ChartPainter(geo, _hover),
                      ),
                      if (h != null)
                        Positioned(
                          left: _padL + _hover! * geo.band + geo.band / 2,
                          top: geo.y(h.total.toDouble()) - 10,
                          child: FractionalTranslation(
                            translation: const Offset(-0.5, -1),
                            child: IgnorePointer(
                              child: Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 12,
                                  vertical: 8,
                                ),
                                decoration: BoxDecoration(
                                  color: C.ink,
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      '${h.total} ${h.total == 1 ? 'reservation' : 'reservations'}',
                                      style: T.body(
                                        16,
                                        weight: FontWeight.w600,
                                        color: Colors.white,
                                      ),
                                    ),
                                    Text(
                                      dayLabel(h.day),
                                      style: T.body(14, color: C.onBrandMuted),
                                    ),
                                    if (h.total > 0) ...[
                                      const SizedBox(height: 4),
                                      Text(
                                        '${h.completed} completed · ${h.noShow} no-show · ${h.cancelled} cancelled',
                                        style: T.body(14, color: C.onBrand),
                                      ),
                                    ],
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
        // its own Material, so the tile's ink shows on the white panel
        Material(
          type: MaterialType.transparency,
          child: Theme(
            data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
            child: ExpansionTile(
              tilePadding: EdgeInsets.zero,
              childrenPadding: EdgeInsets.zero,
              expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
              title: Text(
                'View as a table',
                style: T.body(14, weight: FontWeight.w600, color: C.muted),
              ),
              children: [
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Table(
                    defaultColumnWidth: const IntrinsicColumnWidth(),
                    border: const TableBorder(
                      horizontalInside: BorderSide(color: C.line),
                    ),
                    children: [
                      TableRow(
                        children: [
                          for (final (i, t) in [
                            'Day',
                            'Reservations',
                            'Completed',
                            'No-shows',
                            'Cancelled',
                          ].indexed)
                            _cell(t, head: true, right: i > 0),
                        ],
                      ),
                      for (final d in days)
                        TableRow(
                          children: [
                            _cell(dayLabel(d.day)),
                            _cell('${d.total}', right: true),
                            _cell('${d.completed}', right: true),
                            _cell('${d.noShow}', right: true),
                            _cell('${d.cancelled}', right: true),
                          ],
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _cell(String text, {bool head = false, bool right = false}) => Padding(
    padding: const EdgeInsets.fromLTRB(0, 6, 16, 6),
    child: Text(
      text,
      textAlign: right ? TextAlign.right : TextAlign.left,
      style: T
          .body(
            14,
            weight: head ? FontWeight.w600 : FontWeight.w400,
            color: head ? C.muted : C.ink,
          )
          .copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
    ),
  );
}

class _Geometry {
  _Geometry(this.days, this.width) {
    final max = math.max(4, days.fold(0, (m, d) => math.max(m, d.total)));
    step = _niceStep(max / 4);
    top = (max / step).ceil() * step;
    band = (width - _padL - _padR) / math.max(1, days.length);
    bw = math.min(_barMax, band * 0.55);
  }
  final List<_Day> days;
  final double width;
  late final double step, top, band, bw;
  double get base => _chartH - _padB;
  double y(double v) => _padT + (base - _padT) * (1 - v / top);
}

class _ChartPainter extends CustomPainter {
  _ChartPainter(this.g, this.hover);
  final _Geometry g;
  final int? hover;

  void _text(
    Canvas canvas,
    String s,
    TextStyle style,
    Offset at, {
    TextAlign align = TextAlign.center,
    double haloWidth = 0,
  }) {
    TextPainter make(TextStyle st) => TextPainter(
      text: TextSpan(text: s, style: st),
      textDirection: TextDirection.ltr,
    )..layout();
    final tp = make(style);
    final dx = align == TextAlign.center
        ? at.dx - tp.width / 2
        : align == TextAlign.right
        ? at.dx - tp.width
        : at.dx;
    final dy =
        at.dy -
        tp.computeDistanceToActualBaseline(
          TextBaseline.alphabetic,
        ); // `at` is the baseline, as in SVG
    if (haloWidth > 0) {
      make(
        style.copyWith(
          color: null,
          foreground: Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = haloWidth
            ..color = C.surface,
        ),
      ).paint(canvas, Offset(dx, dy));
    }
    tp.paint(canvas, Offset(dx, dy));
  }

  @override
  void paint(Canvas canvas, Size size) {
    final tabular = const [FontFeature.tabularFigures()];
    for (var t = 0.0; t <= g.top + 0.001; t += g.step) {
      canvas.drawLine(
        Offset(_padL, g.y(t)),
        Offset(g.width - _padR, g.y(t)),
        Paint()
          ..color = C.line
          ..strokeWidth = 1,
      );
      _text(
        canvas,
        '${t.round()}',
        T.body(11, color: C.muted).copyWith(fontFeatures: tabular),
        Offset(_padL - 8, g.y(t) + 4),
        align: TextAlign.right,
      );
    }
    if (g.days.every((d) => d.total == 0)) {
      _text(
        canvas,
        'No reservations in the last 7 days yet',
        T.body(14, color: C.muted),
        Offset((_padL + g.width - _padR) / 2, (_padT + g.base) / 2),
        haloWidth: 8,
      );
    }
    for (var i = 0; i < g.days.length; i++) {
      final d = g.days[i];
      final x = _padL + i * g.band + (g.band - g.bw) / 2;
      if (d.total > 0) {
        // a column with a 4 px rounded top and a square base, growing from the baseline
        final y = g.y(d.total.toDouble());
        final r = math.min(4.0, g.base - y);
        canvas.drawRRect(
          RRect.fromRectAndCorners(
            Rect.fromLTRB(x, y, x + g.bw, g.base),
            topLeft: Radius.circular(r),
            topRight: Radius.circular(r),
          ),
          Paint()..color = i == hover ? C.accent : C.brand,
        );
      }
      final last = i == g.days.length - 1;
      _text(
        canvas,
        last ? 'Today' : _weekday(d.day),
        T.body(
          12,
          weight: last ? FontWeight.w600 : FontWeight.w400,
          color: last ? C.ink : C.muted,
        ),
        Offset(x + g.bw / 2, _chartH - 10),
      );
    }
  }

  @override
  bool shouldRepaint(_ChartPainter old) => true;
}
