import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../api.dart';
import '../app_state.dart';
import '../theme.dart';
import '../ui.dart';

// Demo only (SIMULATOR=1): plays the bay camera and sensor for simulated bays (GoingElectric, and Baywatch Bay 3).
// Bays with a real lock only listen to the real camera and sensor; the server refuses simulated events for them.
// web/components/demo-panel.tsx

const _otherCar = 'B XY 987';
// null: back to the time of day (busy weekday evenings, quiet nights)
const _demand = <({String? level, String label})>[
  (level: null, label: 'Auto'),
  (level: 'quiet', label: 'Quiet'),
  (level: 'normal', label: 'Normal'),
  (level: 'busy', label: 'Busy'),
  (level: 'full', label: 'Full'),
];

// What a tired camera reads: the first look-alike character swapped, else one character dropped
String _misread(String plate) {
  const swaps = {'B': '8', 'O': '0', 'S': '5', 'I': '1', 'Z': '2', 'G': '6'};
  final i = plate.split('').indexWhere(swaps.containsKey);
  if (i >= 0) return plate.substring(0, i) + swaps[plate[i]]! + plate.substring(i + 1);
  return plate.isEmpty ? plate : plate.substring(0, plate.length - 1);
}

/// The header's "Demo" pill. Demo-only UI is violet, so it never reads as part of the driver's product.
class DemoButton extends StatelessWidget {
  const DemoButton({super.key});
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: appState,
    builder: (context, _) {
      if (appState.state?.simulator != true) return const SizedBox.shrink();
      return Material(
        color: C.accentTint,
        shape: StadiumBorder(side: BorderSide(color: C.accent.withValues(alpha: 0.25))),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: () => showSheet<void>(context, title: 'Demo controls', builder: (_) => const _DemoPanel()),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 44),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(LucideIcons.flaskConical, size: 16, color: C.accent),
                  const SizedBox(width: 6),
                  Text(
                    'DEMO',
                    style: T.mono(12, weight: FontWeight.w600, em: 0.1, color: C.accent),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    },
  );
}

class _DemoPanel extends StatefulWidget {
  const _DemoPanel();
  @override
  State<_DemoPanel> createState() => _DemoPanelState();
}

class _DemoPanelState extends State<_DemoPanel> {
  List<Vehicle> _cars = [];
  String _carId = '', _bayId = '', _last = '';
  Bay? _bay; // the selected bay's live state, when it isn't a Baywatch bay (those come with the shell's poll)
  String _fetched = '';

  @override
  void initState() {
    super.initState();
    appState.addListener(_changed);
    api.vehicles().then((list) {
      if (!mounted) return;
      setState(() {
        _cars = list;
        if (_carId.isEmpty && list.isNotEmpty) _carId = list.first.id;
      });
    }, onError: (_) {});
  }

  @override
  void dispose() {
    appState.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  // the Baywatch bays first, then the bays of your next and active bookings
  Map<String, String> get _options {
    final s = appState.state;
    final list = <String, String>{for (final b in s?.realBays ?? const <Bay>[]) b.id: b.name};
    for (final r in [s?.viewer?.active, s?.viewer?.next]) {
      if (r != null) list[r.bayId] = r.bayName;
    }
    return list;
  }

  String get _selected => _bayId.isNotEmpty ? _bayId : (_options.keys.firstOrNull ?? '');

  // a bay outside the shell's poll is fetched, again after each action
  void _fetchBay(String id) {
    final key = '$id:$_last';
    if (_fetched == key) return;
    _fetched = key;
    api
        .bay(id)
        .then(
          (b) {
            if (mounted) setState(() => _bay = b);
          },
          onError: (_) {
            if (mounted) setState(() => _bay = null);
          },
        );
  }

  Future<void> _run(String label, Future<void> Function() fn) async {
    try {
      await fn();
      _last = '$label: done';
      await appState.refresh();
    } catch (e) {
      _last = '$label: $e';
    }
    if (mounted) setState(() {});
  }

  Future<void> _plateEvent(String label, String plate, [String direction = 'in']) =>
      _run(label, () => api.post('/api/sim/plate-events', {'bayId': _selected, 'plate': plate, 'direction': direction}));

  InputDecoration get _select => InputDecoration(
    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(999),
      borderSide: const BorderSide(color: C.lineStrong),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final s = appState.state;
    final selected = _selected;
    final real = s?.realBays.where((b) => b.id == selected).firstOrNull;
    if (selected.isNotEmpty && real == null) _fetchBay(selected);
    final current = real ?? (_bay?.id == selected ? _bay : null);
    final simulated = current?.guard == 'simulated';
    final car = _cars.where((c) => c.id == _carId).firstOrNull;
    final options = _options;

    final events = [
      (label: 'My car arrives', hint: car?.display, needsCar: true, run: () => _plateEvent('My car arrives', car!.display)),
      (
        label: 'My car, plate misread',
        hint: car == null ? null : _misread(car.display),
        needsCar: true,
        run: () => _plateEvent('Misread plate', _misread(car!.display)),
      ),
      (label: 'Camera can’t read the plate', hint: 'nothing readable', needsCar: false, run: () => _plateEvent('Unreadable plate', '')),
      (label: 'Another car parks', hint: _otherCar, needsCar: false, run: () => _plateEvent('Another car parks', _otherCar)),
      (label: 'That car leaves', hint: _otherCar, needsCar: false, run: () => _plateEvent('That car leaves', _otherCar, 'out')),
      (label: 'My car leaves', hint: car?.display, needsCar: true, run: () => _plateEvent('My car leaves', car!.display, 'out')),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text.rich(
          TextSpan(
            children: [
              const TextSpan(text: 'Plays the camera and sensor at simulated bays. Only on with '),
              TextSpan(
                text: 'SIMULATOR=1',
                style: T.mono(15, em: 0, color: C.ink),
              ),
              const TextSpan(text: '.'),
            ],
          ),
          style: T.body(16, color: C.muted),
        ),
        const SizedBox(height: 20),
        Text('Site demand', style: T.body(16, weight: FontWeight.w600)),
        Text('Overrides the time-of-day demand, which sets new prices. Auto goes back to the time of day.', style: T.body(14, color: C.muted)),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.all(4),
          decoration: BoxDecoration(color: C.sunken, borderRadius: BorderRadius.circular(12)),
          child: Row(
            children: [
              for (final d in _demand)
                Expanded(
                  child: Semantics(
                    button: true,
                    selected: s?.demand == d.level,
                    child: Material(
                      color: s?.demand == d.level ? C.surface : Colors.transparent,
                      elevation: s?.demand == d.level ? 1 : 0,
                      borderRadius: BorderRadius.circular(8),
                      child: InkWell(
                        borderRadius: BorderRadius.circular(8),
                        onTap: () => _run('Demand ${d.label.toLowerCase()}', () => api.post('/api/sim/demand', {'level': d.level})),
                        child: SizedBox(
                          height: 44,
                          child: Center(
                            child: Text(
                              d.label.toUpperCase(),
                              style: T.mono(12, weight: FontWeight.w600, em: 0.06, color: s?.demand == d.level ? C.ink : C.muted),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        Text('Bay', style: T.body(16, weight: FontWeight.w600)),
        const SizedBox(height: 6),
        DropdownButtonFormField<String>(
          initialValue: selected.isEmpty ? null : selected,
          isExpanded: true,
          decoration: _select,
          borderRadius: BorderRadius.circular(16),
          items: [
            for (final e in options.entries)
              DropdownMenuItem(
                value: e.key,
                child: Text(e.value, overflow: TextOverflow.ellipsis),
              ),
          ],
          onChanged: (v) => setState(() => _bayId = v ?? ''),
        ),
        const SizedBox(height: 16),
        if (current != null && !simulated)
          Note(
            Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: '${current.name} has a real lock.',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const TextSpan(text: ' It only listens to the real camera and car sensor, so there’s nothing to simulate here.'),
                ],
              ),
            ),
            tone: NoteTone.sunken,
          )
        else ...[
          Material(
            color: C.sunken,
            borderRadius: BorderRadius.circular(16),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Car in bay', style: T.body(16, weight: FontWeight.w600)),
                        Text('A car with no booking: a booked driver gets re-routed.', style: T.body(14, color: C.muted)),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  Switch(
                    value: current?.status == 'occupied',
                    onChanged: selected.isEmpty
                        ? null
                        : (v) => _run(v ? 'Car in bay' : 'Bay vacated', () => api.post('/api/sim/bay', {'bayId': selected, 'occupied': v})),
                  ),
                ],
              ),
            ),
          ),
          if (_cars.length > 1) ...[
            const SizedBox(height: 16),
            Text('My car', style: T.body(16, weight: FontWeight.w600)),
            const SizedBox(height: 6),
            DropdownButtonFormField<String>(
              initialValue: _carId.isEmpty ? null : _carId,
              isExpanded: true,
              decoration: _select,
              borderRadius: BorderRadius.circular(16),
              items: [
                for (final c in _cars)
                  DropdownMenuItem(
                    value: c.id,
                    child: Text('${c.display} · ${c.label}', overflow: TextOverflow.ellipsis),
                  ),
              ],
              onChanged: (v) => setState(() => _carId = v ?? ''),
            ),
          ],
          const SizedBox(height: 16),
          LayoutBuilder(
            builder: (context, box) {
              final two = box.maxWidth >= 440; // the web's sm:grid-cols-2
              return Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final e in events)
                    SizedBox(
                      width: two ? (box.maxWidth - 8) / 2 : box.maxWidth,
                      child: _EventButton(label: e.label, hint: e.hint, onTap: selected.isEmpty || (e.needsCar && car == null) ? null : e.run),
                    ),
                ],
              );
            },
          ),
          if (_cars.isEmpty) ...[const SizedBox(height: 12), Text('Add a car to send its plate.', style: T.body(14, color: C.muted))],
        ],
        if (_last.isNotEmpty) ...[
          const SizedBox(height: 16),
          Semantics(
            liveRegion: true,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              decoration: BoxDecoration(color: C.accentTint, borderRadius: BorderRadius.circular(12)),
              child: Text(_last, style: T.mono(14, em: 0, color: C.ink)),
            ),
          ),
        ],
      ],
    );
  }
}

class _EventButton extends StatelessWidget {
  const _EventButton({required this.label, required this.hint, required this.onTap});
  final String label;
  final String? hint;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => Opacity(
    opacity: onTap == null ? 0.5 : 1,
    child: Material(
      color: C.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: const BorderSide(color: C.lineStrong),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 56),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: T.body(15, weight: FontWeight.w600)),
                // mono, so a misread A8 is visibly not AB (Bebas draws 0 and O alike)
                if (hint != null) Text(hint!, style: T.mono(14, em: 0, color: C.muted)),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}
