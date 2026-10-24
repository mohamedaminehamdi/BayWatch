import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';

import 'api.dart';

const _green = Color(0xFF1F6E5A);

const _ended = {
  'completed': 'Last session completed. The bay is free.',
  'cancelled': 'Reservation cancelled. The bay is free.',
  'no_show': 'Reservation expired before the car arrived (no-show). The bay was released.',
};

class ReservePage extends StatefulWidget {
  const ReservePage({super.key});

  @override
  State<ReservePage> createState() => _ReservePageState();
}

class _ReservePageState extends State<ReservePage> {
  final _api = Api();
  final _map = MapController();
  final _plate = TextEditingController();
  final _simPlate = TextEditingController();
  late final Timer _poll, _tick;
  Timer? _debounce;

  AppState? _state;
  List<Charger> _chargers = [];
  String _connError = '', _error = '', _warning = '';
  bool _busy = false;
  // ponytail: kept in memory, so a restarted app can't cancel its booking. Persist it (shared_preferences) if that matters.
  ({String id, String token})? _mine;

  @override
  void initState() {
    super.initState();
    _refresh();
    _poll = Timer.periodic(const Duration(seconds: 2), (_) => _refresh());
    // redraw the countdown
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (_state?.reservation?.status == 'reserved') setState(() {});
    });
  }

  @override
  void dispose() {
    _poll.cancel();
    _tick.cancel();
    _debounce?.cancel();
    _plate.dispose();
    _simPlate.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    try {
      final s = await _api.state();
      if (!mounted) return;
      setState(() {
        _state = s;
        _connError = '';
      });
    } catch (e) {
      if (mounted) setState(() => _connError = 'Server not reachable: $e');
    }
  }

  Future<void> _loadChargers() async {
    final cam = _map.camera;
    if (cam.zoom < 11) {
      setState(() {
        _chargers = [];
        _warning = 'Zoom in to see public charge points.';
      });
      return;
    }
    final b = cam.visibleBounds;
    try {
      final r = await _api.chargers(south: b.south, west: b.west, north: b.north, east: b.east);
      if (!mounted) return;
      setState(() {
        _chargers = r.chargers;
        _warning = r.warning ?? (r.more ? 'Showing the first 500 charge points. Zoom in for all of them.' : '');
      });
    } catch (e) {
      if (mounted) setState(() => _warning = 'Could not load charge points: $e');
    }
  }

  Future<void> _act(Future<void> Function() fn) async {
    setState(() {
      _error = '';
      _busy = true;
    });
    try {
      await fn();
    } catch (e) {
      _error = '$e';
    }
    if (!mounted) return;
    setState(() => _busy = false);
    _refresh();
  }

  void _showCharger(Charger c) => showModalBottomSheet<void>(
        context: context,
        builder: (_) => Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(c.name, style: Theme.of(context).textTheme.titleMedium),
              Text(c.address),
              const SizedBox(height: 8),
              for (final p in c.points) Text(p),
              if (c.fault) const Text('Fault reported', style: TextStyle(fontWeight: FontWeight.bold)),
              if (c.url != null)
                TextButton(onPressed: () => launchUrl(Uri.parse(c.url!)), child: const Text('Details on GoingElectric')),
            ],
          ),
        ),
      );

  Widget _dot(Color fill, double size, {Color border = Colors.white, Widget? child}) => Container(
        width: size,
        height: size,
        decoration: BoxDecoration(color: fill, shape: BoxShape.circle, border: Border.all(color: border, width: 2)),
        child: child,
      );

  @override
  Widget build(BuildContext context) {
    final s = _state;
    if (s == null) return Scaffold(body: Center(child: Text(_connError.isEmpty ? 'Loading…' : _connError)));

    final bay = LatLng(s.bay.lat, s.bay.lng);
    return Scaffold(
      body: Stack(
        children: [
          FlutterMap(
            mapController: _map,
            options: MapOptions(
              initialCenter: bay,
              initialZoom: 14,
              onMapReady: _loadChargers,
              // debounced: load once the map stops moving
              onPositionChanged: (_, _) {
                _debounce?.cancel();
                _debounce = Timer(const Duration(milliseconds: 400), _loadChargers);
              },
            ),
            children: [
              TileLayer(
                urlTemplate: 'https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=irAhmpZT2WsOW6tsnZl3',
                additionalOptions: const {
                  'apiKey': 'irAhmpZT2WsOW6tsnZl3',
                },
                userAgentPackageName: 'io.ecurious.ecurious_reserve',
                maxZoom: 19,
              ),
              MarkerLayer(
                markers: [
                  for (final c in _chargers)
                    Marker(
                      point: LatLng(c.lat, c.lng),
                      width: 16,
                      height: 16,
                      child: GestureDetector(
                        onTap: () => _showCharger(c),
                        child: _dot((c.fault ? const Color(0xFFB3261E) : const Color(0xFF2B6CB0)).withValues(alpha: 0.6), 16),
                      ),
                    ),
                  Marker(
                    point: bay,
                    width: 30,
                    height: 30,
                    child: Tooltip(
                      message: '${s.bay.name}: reservable with Ecurious',
                      child: _dot(_green, 30, child: const Icon(Icons.bolt, color: Colors.white, size: 18)),
                    ),
                  ),
                ],
              ),
            ],
          ),
          Align(
            alignment: MediaQuery.sizeOf(context).width >= 720 ? Alignment.topLeft : Alignment.bottomCenter,
            child: SafeArea(
              child: ConstrainedBox(
                constraints: BoxConstraints(maxWidth: 420, maxHeight: MediaQuery.sizeOf(context).height * 0.6),
                child: Card(
                  margin: const EdgeInsets.all(12),
                  color: Colors.white,
                  child: SingleChildScrollView(padding: const EdgeInsets.all(16), child: _panel(s)),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _panel(AppState s) {
    final r = s.reservation;
    final muted = TextStyle(color: Colors.grey.shade700, fontSize: 13);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(s.bay.name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        Text('Reservation hardware: ${s.hardwareState}${s.hardwareMock ? ' (mock)' : ''}', style: muted),
        const SizedBox(height: 8),
        ..._flow(s, r, muted),
        if (_error.isNotEmpty || _connError.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(_error.isNotEmpty ? _error : _connError, style: const TextStyle(color: Color(0xFFB3261E))),
          ),
        if (s.simulator)
          ExpansionTile(
            title: const Text('Camera simulator'),
            tilePadding: EdgeInsets.zero,
            childrenPadding: const EdgeInsets.only(bottom: 8),
            expandedCrossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Sends a plate event, as the bay camera will once the Ecurious server is connected.', style: muted),
              const SizedBox(height: 8),
              Row(children: [
                Expanded(child: _plateField(_simPlate, 'Plate seen by the camera')),
                const SizedBox(width: 8),
                OutlinedButton(
                  onPressed: _busy
                      ? null
                      : () => _act(() async {
                            if (!await _api.simulatePlate(_simPlate.text)) {
                              _error = 'Camera event sent: plate did not match an active reservation.';
                            }
                          }),
                  child: const Text('Send plate'),
                ),
              ]),
            ],
          ),
        ExpansionTile(
          title: const Text('Event log'),
          tilePadding: EdgeInsets.zero,
          expandedCrossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final l in s.log)
              Text('${TimeOfDay.fromDateTime(l.at).format(context)} · ${l.type}${l.detail.isEmpty ? '' : ' · ${l.detail}'}',
                  style: muted),
          ],
        ),
        if (_warning.isNotEmpty)
          Container(
            width: double.infinity,
            margin: const EdgeInsets.only(top: 8),
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(color: const Color(0xFFFFF0E6), borderRadius: BorderRadius.circular(8)),
            child: Text(_warning, style: muted),
          ),
        // the map's own attribution corner is covered by this panel on phones
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Wrap(spacing: 4, children: [
            _link('© OpenStreetMap', 'https://www.openstreetmap.org/copyright'),
            Text('·', style: muted),
            _link('Charging data © GoingElectric.de', 'https://www.goingelectric.de/stromtankstellen/'),
          ]),
        ),
      ],
    );
  }

  List<Widget> _flow(AppState s, Reservation? r, TextStyle muted) {
    Widget button(String label, String action, {bool primary = true}) {
      final onPressed = _busy ? null : () => _act(() => _api.step(action, _mine?.token));
      return primary
          ? FilledButton(onPressed: onPressed, child: Text(label))
          : OutlinedButton(onPressed: onPressed, child: Text(label));
    }

    if (r != null && r.active && r.id != _mine?.id) {
      return [
        Row(children: [_badge(r.status == 'reserved' ? 'Reserved' : 'In use', const Color(0xFFFFF1BF)), const Text('  by another driver')]),
        const SizedBox(height: 8),
        const Text('The bay is free again when they finish or their reservation runs out.'),
      ];
    }

    switch (r?.status) {
      case 'reserved':
        final left = r!.expiresAt.difference(DateTime.now());
        final sec = left.isNegative ? 0 : left.inSeconds;
        return [
          Row(children: [_badge('Reserved', const Color(0xFFFFF1BF)), Text('  for ${r.plateHint}')]),
          const SizedBox(height: 8),
          Text('The bay is blocked for you for ${sec ~/ 60}:${(sec % 60).toString().padLeft(2, '0')}. '
              'The camera checks you in when you arrive.'),
          const SizedBox(height: 8),
          Wrap(spacing: 8, children: [
            OutlinedButton(
              onPressed: () => launchUrl(
                Uri.parse('https://www.google.com/maps/dir/?api=1&destination=${s.bay.lat},${s.bay.lng}'),
                mode: LaunchMode.externalApplication,
              ),
              child: const Text('Navigate'),
            ),
            button('Cancel', 'cancel', primary: false),
          ]),
        ];
      case 'arrived':
        return [
          _badge('Checked in', const Color(0xFFC9F0D5)),
          const SizedBox(height: 8),
          const Text('Plate recognised. The bay is released: park and plug in.'),
          const SizedBox(height: 8),
          button('Start charging', 'charge'),
          const SizedBox(height: 4),
          Text("Simulated: the charger itself isn't connected yet.", style: muted),
        ];
      case 'charging':
        return [
          _badge('Charging', const Color(0xFFC9F0D5)),
          const SizedBox(height: 8),
          button('Finish and leave', 'finish'),
        ];
      default:
        return [
          if (r != null) Text(_ended[r.status] ?? r.status),
          Text('Reserve the bay and it is held for you for ${s.holdMinutes} min.'),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(child: _plateField(_plate, 'Your license plate', onSubmitted: (_) => _reserve())),
            const SizedBox(width: 8),
            FilledButton(onPressed: _busy ? null : _reserve, child: const Text('Reserve')),
          ]),
          const SizedBox(height: 4),
          Text('Your plate is used only to check you in at the bay and is deleted when the reservation ends.', style: muted),
        ];
    }
  }

  void _reserve() => _act(() async {
        _mine = await _api.reserve(_plate.text);
        _simPlate.text = _plate.text;
      });

  Widget _plateField(TextEditingController c, String label, {ValueChanged<String>? onSubmitted}) => TextField(
        controller: c,
        textCapitalization: TextCapitalization.characters,
        onSubmitted: onSubmitted,
        decoration: InputDecoration(
          labelText: label,
          hintText: 'M AB 1234',
          isDense: true,
          border: const OutlineInputBorder(),
        ),
      );

  Widget _badge(String text, Color bg) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(99)),
        child: Text(text, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
      );

  Widget _link(String text, String url) => InkWell(
        onTap: () => launchUrl(Uri.parse(url)),
        child: Text(text, style: const TextStyle(fontSize: 12, color: _green, decoration: TextDecoration.underline)),
      );
}
