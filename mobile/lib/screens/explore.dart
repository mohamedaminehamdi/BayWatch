import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'dart:ui' show lerpDouble;

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart' hide Path;
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../api.dart';
import '../app_state.dart';
import '../format.dart';
import '../theme.dart';
import '../ui.dart';
import 'booking.dart';
import 'booking_flow.dart';

// Find a charger: the map with every GoingElectric charger in view and the three Baywatch bays, a search, the
// filters, and a sheet with the list or one bay's details. web/components/explore/{explore,panels,map-view}.tsx

const _minZoom = 10.5; // wider than this, GoingElectric would return a whole region
const _listCap = 50;
const _clusterMaxZoom = 13.0;
const _clusterRadius = 34.0; // px
const _pinGap = 64.0; // the Baywatch bays stand a few metres apart, so their pins sit side by side at any zoom
const _peek = 184.0; // the closed sheet shows its handle and the first rows

typedef _View = ({Point center, LatLngBounds bounds, double zoom});
typedef _Row = ({Bay bay, double? distance});

LatLng _ll(Point p) => LatLng(p.lat, p.lng);

class ExploreScreen extends StatefulWidget {
  const ExploreScreen({super.key});
  @override
  State<ExploreScreen> createState() => _ExploreScreenState();
}

class _ExploreScreenState extends State<ExploreScreen> with TickerProviderStateMixin {
  final _map = MapController();
  final _query = TextEditingController();
  final _cache = <String, BaysResponse>{};
  late final _fly = AnimationController(vsync: this);
  VoidCallback? _flyTick;
  Timer? _settle;
  bool _ready = false;
  int _req = 0; // drops answers for an area the map has since left

  _View? _view;
  BaysResponse _found = BaysResponse.empty();
  String _loadError = '', _searchNote = '';
  bool _fast = false, _freeNow = false, _sheetOpen = false;
  Point? _me;
  String? _selectedId;

  @override
  void dispose() {
    _settle?.cancel();
    _fly.dispose();
    _query.dispose();
    super.dispose();
  }

  // the visible area, once the map has stopped moving (the web's moveend)
  void _moved() {
    _settle?.cancel();
    _settle = Timer(const Duration(milliseconds: 350), _report);
  }

  void _report() {
    if (!mounted || !_ready) return;
    final cam = _map.camera;
    setState(() => _view = (center: (lat: cam.center.latitude, lng: cam.center.longitude), bounds: cam.visibleBounds, zoom: cam.zoom));
    _load();
  }

  // GoingElectric bays for the visible area: once per area (cached), never zoomed far out
  Future<void> _load() async {
    final v = _view;
    if (v == null || v.zoom < _minZoom) return;
    final [w, s, e, n] = [v.bounds.west, v.bounds.south, v.bounds.east, v.bounds.north].map((x) => x.toStringAsFixed(3)).toList();
    final key = '$w,$s,$e,$n,$_fast';
    final req = ++_req;
    try {
      final hit = _cache[key] ??
          await api.bays(south: double.parse(s), west: double.parse(w), north: double.parse(n), east: double.parse(e), fast: _fast);
      _cache[key] = hit;
      if (!mounted || req != _req) return;
      setState(() {
        _found = hit;
        _loadError = '';
      });
    } catch (err) {
      if (mounted && req == _req) setState(() => _loadError = 'Couldn’t load chargers: $err');
    }
  }

  void _flyTo(Point p, double zoom, {int ms = 900}) {
    if (!_ready) return;
    final cam = _map.camera;
    final from = cam.center, z0 = cam.zoom;
    if (MediaQuery.of(context).disableAnimations) {
      _map.move(_ll(p), zoom);
      return;
    }
    if (_flyTick != null) _fly.removeListener(_flyTick!);
    final curve = CurvedAnimation(parent: _fly, curve: Curves.easeInOutCubic);
    _flyTick = () {
      final t = curve.value;
      _map.move(LatLng(lerpDouble(from.latitude, p.lat, t)!, lerpDouble(from.longitude, p.lng, t)!), lerpDouble(z0, zoom, t)!);
    };
    _fly
      ..duration = Duration(milliseconds: ms)
      ..addListener(_flyTick!)
      ..forward(from: 0);
  }

  List<Bay> get _realBays {
    final live = appState.state?.realBays ?? const [];
    return live.isNotEmpty ? live : _found.realBays;
  }

  Map<String, Bay> get _all => {for (final b in [..._found.bays, ..._realBays]) b.id: b};

  void _select(String id) {
    final target = _all[id];
    setState(() {
      _selectedId = id;
      _sheetOpen = true;
    });
    if (target != null) _flyTo(target.point, math.max(_view?.zoom ?? 14.5, 14.5));
  }

  Future<void> _locate() async {
    try {
      final here = await locate();
      if (!mounted) return;
      setState(() {
        _me = here;
        _searchNote = '';
      });
      _flyTo(here, 14);
    } catch (_) {
      if (mounted) setState(() => _searchNote = 'Location is off. Allow it in your settings to sort chargers by distance from you.');
    }
  }

  // Nominatim on submit only: its usage policy doesn't allow search-as-you-type
  Future<void> _search() async {
    final q = _query.text.trim();
    if (q.isEmpty) return;
    setState(() => _searchNote = 'Searching…');
    try {
      final res = await http.get(
        Uri.parse('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${Uri.encodeQueryComponent(q)}'),
        headers: kIsWeb ? const {} : const {'User-Agent': 'Baywatch/0.2 (hackathon prototype)'},
      );
      final places = jsonDecode(res.body) as List;
      if (!mounted) return;
      if (places.isEmpty) return setState(() => _searchNote = 'No place found for “$q”.');
      final place = places.first as Map<String, dynamic>;
      setState(() {
        _searchNote = '';
        _selectedId = null;
      });
      _flyTo((lat: double.parse(place['lat'] as String), lng: double.parse(place['lon'] as String)), 14);
    } catch (_) {
      if (mounted) setState(() => _searchNote = 'Search isn’t available right now.');
    }
  }

  void _book(Bay b) => showBookingFlow(context, b);

  @override
  Widget build(BuildContext context) => ListenableBuilder(listenable: appState, builder: (context, _) => _build(context));

  Widget _build(BuildContext context) {
    final realBays = _realBays;
    if (appState.state == null && realBays.isEmpty) return Container(color: C.sunken);

    final v = _view;
    final from = _me ?? v?.center; // distances are from you, or from the map centre
    final others = _found.bays.where((b) => !b.real).toList();
    final rows = <_Row>[
      for (final b in others)
        if (!_freeNow || b.green) (bay: b, distance: from == null ? null : distanceM(from, b.point)),
    ]..sort((a, b) => (a.distance ?? 0).compareTo(b.distance ?? 0));
    final shown = rows.take(_listCap).toList();
    final more = others.length > _listCap;
    final zoomNote = v != null && v.zoom < _minZoom ? 'Zoom in to see the chargers around you.' : '';
    final note = [
      _loadError,
      _found.warning ?? '',
      zoomNote,
      v != null && shown.isEmpty ? (_freeNow ? 'No free chargers in this area right now.' : 'No chargers in this area.') : '',
    ].firstWhere((s) => s.isNotEmpty, orElse: () => '');

    final selected = _selectedId == null ? null : _all[_selectedId];
    final panel = selected != null
        // details only show distance from you: the map re-centres on what you picked, so a centre distance means nothing
        ? _BayPanel(
            key: ValueKey(selected.id),
            bay: selected,
            distance: _me == null ? null : distanceM(_me!, selected.point),
            onBack: () => setState(() => _selectedId = null),
            onBook: _book,
          )
        : _BayList(realBays: realBays, rows: shown, fromYou: _me != null, more: more, note: note, onSelect: _select, onBook: _book);

    final center = realBays.isNotEmpty ? realBays.first.point : (lat: 52.52, lng: 13.405);
    final sheetLabel = _sheetOpen ? 'Show map' : shown.isNotEmpty ? '${shown.length}${more ? '+' : ''} chargers nearby' : 'Chargers';

    return LayoutBuilder(builder: (context, box) {
      final sheetH = box.maxHeight * 0.78;
      return Stack(children: [
        Positioned.fill(
          child: FlutterMap(
            mapController: _map,
            options: MapOptions(
              initialCenter: _ll(center),
              initialZoom: 13.4,
              minZoom: 3,
              maxZoom: 19,
              interactionOptions: const InteractionOptions(flags: InteractiveFlag.all & ~InteractiveFlag.rotate),
              onMapReady: () {
                _ready = true;
                _report();
              },
              onPositionChanged: (_, _) => _moved(),
            ),
            children: [
              TileLayer(
                urlTemplate: 'https://api.maptiler.com/maps/positron/{z}/{x}/{y}.png?key=irAhmpZT2WsOW6tsnZl3',
                tileDimension: 512,
                zoomOffset: -1,
                maxZoom: 19,
                userAgentPackageName: 'io.ecurious.ecurious_reserve',
              ),
              _BayLayer(bays: others, selectedId: _selectedId, onSelect: _select, onCluster: (p, z) => _flyTo(p, z, ms: 500)),
              if (_me != null)
                CircleLayer(circles: [
                  CircleMarker(point: _ll(_me!), radius: 16, color: C.location.withValues(alpha: 0.15)),
                  CircleMarker(point: _ll(_me!), radius: 7, color: C.location, borderColor: C.surface, borderStrokeWidth: 3),
                ]),
              _PinLayer(bays: realBays, selectedId: _selectedId, onSelect: _select),
              // above the closed sheet, which covers the map's bottom corner on phones
              Padding(
                padding: const EdgeInsets.only(bottom: _peek + 8),
                child: RichAttributionWidget(
                  showFlutterMapAttribution: false,
                  attributions: [
                    TextSourceAttribution('MapTiler', onTap: () => openUrl(Uri.parse('https://www.maptiler.com/copyright/'))),
                    TextSourceAttribution('OpenStreetMap contributors', onTap: () => openUrl(Uri.parse('https://www.openstreetmap.org/copyright'))),
                    TextSourceAttribution('Charging data: GoingElectric.de', onTap: () => openUrl(Uri.parse('https://www.goingelectric.de/stromtankstellen/'))),
                  ],
                ),
              ),
            ],
          ),
        ),
        Positioned(left: 12, right: 12, top: 12, child: _controls()),

        // the list and details live in a sheet over the map
        AnimatedPositioned(
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
          left: 0,
          right: 0,
          height: sheetH,
          bottom: _sheetOpen ? 0 : -(sheetH - _peek),
          child: Container(
            decoration: BoxDecoration(
              color: C.page,
              borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
              boxShadow: [BoxShadow(color: C.ink.withValues(alpha: 0.3), blurRadius: 40, offset: const Offset(0, -12), spreadRadius: -12)],
            ),
            child: Column(children: [
              Semantics(
                button: true,
                expanded: _sheetOpen,
                child: InkWell(
                  borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
                  onTap: () => setState(() => _sheetOpen = !_sheetOpen),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(minHeight: 44, minWidth: double.infinity),
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 10, 16, 8),
                      child: Column(children: [
                        Container(width: 40, height: 6, decoration: BoxDecoration(color: C.lineStrong.withValues(alpha: 0.6), borderRadius: BorderRadius.circular(99))),
                        const SizedBox(height: 6),
                        Row(mainAxisSize: MainAxisSize.min, children: [
                          Text(sheetLabel.toUpperCase(), style: T.mono(12, weight: FontWeight.w600, em: 0.1, color: C.muted)),
                          const SizedBox(width: 4),
                          AnimatedRotation(
                            turns: _sheetOpen ? 0.5 : 0,
                            duration: const Duration(milliseconds: 200),
                            child: const Icon(LucideIcons.chevronUp, size: 16, color: C.muted),
                          ),
                        ]),
                      ]),
                    ),
                  ),
                ),
              ),
              Expanded(child: SingleChildScrollView(padding: const EdgeInsets.fromLTRB(16, 0, 16, 24), child: panel)),
            ]),
          ),
        ),
      ]);
    });
  }

  Widget _controls() {
    final shadow = [BoxShadow(color: C.ink.withValues(alpha: 0.2), blurRadius: 10, offset: const Offset(0, 2), spreadRadius: -2)];
    Widget chip(bool on, String label, VoidCallback toggle) => Semantics(
          toggled: on,
          button: true,
          child: Material(
            color: on ? C.ink : C.surface,
            shape: StadiumBorder(side: BorderSide(color: on ? C.ink : C.lineStrong)),
            elevation: 0,
            shadowColor: Colors.transparent,
            child: InkWell(
              customBorder: const StadiumBorder(),
              onTap: toggle,
              child: Container(
                constraints: const BoxConstraints(minHeight: 44),
                padding: const EdgeInsets.symmetric(horizontal: 16),
                alignment: Alignment.center,
                child: Text(label.toUpperCase(), style: T.mono(12, weight: FontWeight.w600, color: on ? C.onBrand : C.ink)),
              ),
            ),
          ),
        );
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [
        Expanded(
          child: DecoratedBox(
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(99), boxShadow: shadow),
            child: TextField(
              controller: _query,
              textInputAction: TextInputAction.search,
              onSubmitted: (_) => _search(),
              decoration: const InputDecoration(
                hintText: 'Search a city or address',
                prefixIcon: Icon(LucideIcons.search, size: 20, color: C.faint),
                contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              ),
            ),
          ),
        ),
        const SizedBox(width: 8),
        Material(
          color: C.surface,
          shape: const CircleBorder(side: BorderSide(color: C.lineStrong)),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: _locate,
            child: Tooltip(
              message: 'Locate me',
              child: const SizedBox.square(dimension: 48, child: Icon(LucideIcons.locateFixed, size: 20, color: C.ink)),
            ),
          ),
        ),
      ]),
      const SizedBox(height: 10),
      SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(children: [
          chip(_fast, 'Fast ≥ 50 kW', () {
            setState(() => _fast = !_fast);
            _load();
          }),
          const SizedBox(width: 8),
          chip(_freeNow, 'Free now', () => setState(() => _freeNow = !_freeNow)),
        ]),
      ),
      if (_searchNote.isNotEmpty) ...[
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          decoration: BoxDecoration(color: C.surface, borderRadius: BorderRadius.circular(16), border: Border.all(color: C.line), boxShadow: shadow),
          child: Semantics(liveRegion: true, child: Text(_searchNote, style: T.body(14, color: C.muted))),
        ),
      ],
    ]);
  }
}

// ── the map layers ──

// ponytail: greedy O(n²) clustering in screen space at the whole zoom level, fine for the 500 bays GoingElectric
// returns at most; a spatial index if that cap ever goes up
List<List<Bay>>? _clusters;
(List<Bay>, double)? _clusteredFor;

List<List<Bay>> _cluster(List<Bay> bays, MapCamera cam) {
  final z = cam.zoom.floorToDouble();
  if (_clusteredFor case (final b, final zz) when identical(b, bays) && zz == z) return _clusters!;
  final pts = [for (final b in bays) cam.projectAtZoom(LatLng(b.lat, b.lng), z)];
  final used = List.filled(bays.length, false);
  final out = <List<Bay>>[];
  for (var i = 0; i < bays.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    final group = [bays[i]];
    for (var j = i + 1; j < bays.length; j++) {
      if (!used[j] && (pts[j] - pts[i]).distance <= _clusterRadius) {
        used[j] = true;
        group.add(bays[j]);
      }
    }
    out.add(group);
  }
  _clusteredFor = (bays, z);
  return _clusters = out;
}

// Hundreds of GoingElectric bays: ink ring fast, grey slow, red offline or faulty; clustered when zoomed out
class _BayLayer extends StatelessWidget {
  const _BayLayer({required this.bays, required this.selectedId, required this.onSelect, required this.onCluster});
  final List<Bay> bays;
  final String? selectedId;
  final ValueChanged<String> onSelect;
  final void Function(Point at, double zoom) onCluster;

  @override
  Widget build(BuildContext context) {
    final cam = MapCamera.of(context);
    final groups = cam.zoom <= _clusterMaxZoom ? _cluster(bays, cam) : [for (final b in bays) [b]];
    return MarkerLayer(markers: [
      for (final g in groups)
        if (g.length == 1) _dot(g.first) else _clusterMarker(g, cam),
    ]);
  }

  Marker _dot(Bay b) {
    final sel = b.id == selectedId;
    final edge = b.offline
        ? C.danger
        : sel
            ? C.accent
            : b.powerKw >= 50
                ? C.ink
                : C.context;
    final r = sel ? 10.0 : 7.0;
    final w = sel ? 4.0 : 3.0;
    return Marker(
      point: LatLng(b.lat, b.lng),
      width: 36,
      height: 36,
      child: Semantics(
        button: true,
        label: b.name,
        child: GestureDetector(
          onTap: () => onSelect(b.id),
          child: Center(
            child: Container(
              width: (r + w) * 2,
              height: (r + w) * 2,
              decoration: BoxDecoration(color: C.surface, shape: BoxShape.circle, border: Border.all(color: edge, width: w)),
            ),
          ),
        ),
      ),
    );
  }

  Marker _clusterMarker(List<Bay> g, MapCamera cam) {
    final lat = g.map((b) => b.lat).reduce((a, b) => a + b) / g.length;
    final lng = g.map((b) => b.lng).reduce((a, b) => a + b) / g.length;
    final r = g.length < 10 ? 15.0 : g.length < 50 ? 19.0 : 24.0;
    return Marker(
      point: LatLng(lat, lng),
      width: (r + 2.5) * 2,
      height: (r + 2.5) * 2,
      child: Semantics(
        button: true,
        label: '${g.length} chargers, zoom in',
        child: GestureDetector(
          onTap: () => onCluster((lat: lat, lng: lng), math.min(cam.zoom + 2, 14.3)),
          child: Container(
            alignment: Alignment.center,
            decoration: BoxDecoration(color: C.ink.withValues(alpha: 0.92), shape: BoxShape.circle, border: Border.all(color: C.surface, width: 2.5)),
            child: Text('${g.length}', style: T.body(13, weight: FontWeight.w700, color: C.surface, height: 1)),
          ),
        ),
      ),
    );
  }
}

const _statusWord = {'free': 'free', 'reserved': 'reserved', 'occupied': 'occupied', 'offline': 'offline right now'};

// The three Baywatch bays: big, violet, always on the map, side by side
class _PinLayer extends StatelessWidget {
  const _PinLayer({required this.bays, required this.selectedId, required this.onSelect});
  final List<Bay> bays;
  final String? selectedId;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    final cam = MapCamera.of(context);
    return MarkerLayer(markers: [
      for (var i = 0; i < bays.length; i++)
        Marker(
          key: ValueKey(bays[i].id),
          // shifted sideways in pixels, so the pins never overlap however far out the map is
          point: cam.unprojectAtZoom(cam.projectAtZoom(LatLng(bays[i].lat, bays[i].lng)) + Offset((i - (bays.length - 1) / 2) * _pinGap, 0)),
          width: 76,
          height: 92,
          alignment: Alignment.topCenter,
          child: _Pin(bay: bays[i], selected: bays[i].id == selectedId, onTap: () => onSelect(bays[i].id)),
        ),
    ]);
  }
}

class _Pin extends StatelessWidget {
  const _Pin({required this.bay, required this.selected, required this.onTap});
  final Bay bay;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final b = bay;
    final offline = b.offline;
    final label = '${b.name}, ${b.guard == 'hardware' ? 'real barrier' : 'no hardware assigned yet'}, ${_statusWord[b.status] ?? b.status}${b.green ? ', can be unlocked now' : ''}';
    const tear = BorderRadius.only(topLeft: Radius.circular(28), topRight: Radius.circular(28), bottomLeft: Radius.circular(28));
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      excludeSemantics: true,
      child: GestureDetector(
        onTap: onTap,
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          AnimatedScale(
            scale: selected ? 1.1 : 1,
            duration: const Duration(milliseconds: 150),
            child: SizedBox(
              width: 64,
              height: 64,
              child: Stack(alignment: Alignment.center, clipBehavior: Clip.none, children: [
                if (b.green && !offline) const _PulseRing(),
                if (selected)
                  Transform.rotate(
                    angle: math.pi / 4,
                    child: Container(
                      width: 66,
                      height: 66,
                      decoration: BoxDecoration(
                        border: Border.all(color: C.ink, width: 3),
                        borderRadius: const BorderRadius.only(topLeft: Radius.circular(33), topRight: Radius.circular(33), bottomLeft: Radius.circular(33)),
                      ),
                    ),
                  ),
                // a teardrop pointing at the bay: a rotated square, one corner sharp
                Transform.rotate(
                  angle: math.pi / 4,
                  child: Container(
                    width: 56,
                    height: 56,
                    decoration: BoxDecoration(
                      color: offline ? C.sunken : C.accent,
                      borderRadius: tear,
                      border: Border.all(color: offline ? C.faint : C.surface, width: 3),
                      boxShadow: [BoxShadow(color: C.ink.withValues(alpha: 0.5), blurRadius: 24, offset: const Offset(0, 10), spreadRadius: -6)],
                    ),
                  ),
                ),
                _Bolt(size: 24, color: offline ? C.faint : C.surface),
                // the virtual LED: green (lime) can unlock now, red reserved soon or occupied
                if (!offline)
                  Positioned(
                    right: 2,
                    top: 2,
                    child: Container(
                      width: 14,
                      height: 14,
                      decoration: BoxDecoration(color: b.green ? C.signal : C.danger, shape: BoxShape.circle, border: Border.all(color: C.surface, width: 2)),
                    ),
                  ),
              ]),
            ),
          ),
          const SizedBox(height: 6),
          // the three pins look alike: the number tells them apart
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: const ShapeDecoration(color: C.ink, shape: StadiumBorder()),
            child: Text(b.name.replaceFirst(RegExp(r'^Baywatch '), '').toUpperCase(), style: T.mono(11, weight: FontWeight.w600, em: 0.06, color: C.onBrand)),
          ),
        ]),
      ),
    );
  }
}

// A green bay's halo: grows and fades every 2.4 s (the web's animate-pulse-ring)
class _PulseRing extends StatefulWidget {
  const _PulseRing();
  @override
  State<_PulseRing> createState() => _PulseRingState();
}

class _PulseRingState extends State<_PulseRing> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 2400))..repeat();
  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: _c,
        builder: (_, _) {
          final t = Curves.easeOutQuart.transform((_c.value / 0.8).clamp(0.0, 1.0));
          return Transform.scale(
            scale: 0.6 + 1.3 * t,
            child: Opacity(
              opacity: 0.55 * (1 - t),
              child: Container(width: 48, height: 48, decoration: BoxDecoration(color: C.accent.withValues(alpha: 0.4), shape: BoxShape.circle)),
            ),
          );
        },
      );
}

// Lucide's zap, filled (the icon font only has outlines)
class _Bolt extends StatelessWidget {
  const _Bolt({required this.size, required this.color});
  final double size;
  final Color color;
  @override
  Widget build(BuildContext context) => CustomPaint(size: Size.square(size), painter: _BoltPainter(color));
}

class _BoltPainter extends CustomPainter {
  _BoltPainter(this.color);
  final Color color;
  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / 24);
    canvas.drawPath(
      Path()
        ..moveTo(13, 2)
        ..lineTo(3.5, 14)
        ..lineTo(12, 14)
        ..lineTo(11, 22)
        ..lineTo(20.5, 10)
        ..lineTo(12, 10)
        ..close(),
      Paint()
        ..color = color
        ..strokeJoin = StrokeJoin.round,
    );
  }

  @override
  bool shouldRepaint(_BoltPainter old) => old.color != color;
}

// ── the sheet: the list, or one bay ──

String _kw(double p) => p == p.roundToDouble() ? p.toInt().toString() : p.toStringAsFixed(1);

class _BayList extends StatelessWidget {
  const _BayList({
    required this.realBays,
    required this.rows,
    required this.fromYou,
    required this.more,
    required this.note,
    required this.onSelect,
    required this.onBook,
  });
  final List<Bay> realBays;
  final List<_Row> rows;
  final bool fromYou, more;
  final String note;
  final ValueChanged<String> onSelect;
  final ValueChanged<Bay> onBook;

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const SectionLabel('Demo bays'),
        const SizedBox(height: 12),
        for (final b in realBays)
          Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
            decoration: BoxDecoration(color: C.brandDeep, borderRadius: BorderRadius.circular(16)),
            child: Row(children: [
              Expanded(
                child: InkWell(
                  borderRadius: BorderRadius.circular(12),
                  onTap: () => onSelect(b.id),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(minHeight: 44),
                    child: Row(children: [
                      Container(
                        width: 44,
                        height: 44,
                        alignment: Alignment.center,
                        decoration: const BoxDecoration(color: C.accent, shape: BoxShape.circle),
                        child: const _Bolt(size: 20, color: C.surface),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(b.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: T.display(24, color: C.onBrand, height: 1)),
                          const SizedBox(height: 6),
                          Row(children: [
                            if (!b.offline) ...[Led(b.green, onDark: true), const SizedBox(width: 8)],
                            Flexible(
                              child: Text(
                                '${bayStatus[b.status]?.label ?? b.status} · ${b.kw} kW · from ${formatEuro(b.priceFromCents)}'.toUpperCase(),
                                style: T.mono(12, em: 0.08, color: C.onBrandMuted),
                              ),
                            ),
                          ]),
                          const SizedBox(height: 4),
                          Text(hardwareNote(b.guard, b.real).toUpperCase(), style: T.mono(12, em: 0.08, color: C.onBrandAccent)),
                        ]),
                      ),
                    ]),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Semantics(
                label: 'Book ${b.name} now',
                excludeSemantics: true,
                child: Btn('Book now', variant: BtnVariant.signal, size: BtnSize.sm, onPressed: b.offline ? null : () => onBook(b)),
              ),
            ]),
          ),
        if (realBays.isEmpty)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(color: C.sunken, borderRadius: BorderRadius.circular(16)),
            child: Text('The demo bays aren’t reachable right now.', style: T.body(14, color: C.muted)),
          ),
        const SizedBox(height: 28),
        Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
          const Expanded(child: SectionLabel('Chargers nearby')),
          Text(fromYou ? 'Nearest to you' : 'Nearest to the map centre', style: T.body(14, color: C.muted)),
        ]),
        if (note.isNotEmpty)
          Container(
            margin: const EdgeInsets.only(top: 12),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(color: C.sunken, borderRadius: BorderRadius.circular(16)),
            child: Text(note, style: T.body(14, color: C.muted)),
          ),
        const SizedBox(height: 8),
        for (var i = 0; i < rows.length; i++) _row(rows[i], first: i == 0),
        if (more) Padding(padding: const EdgeInsets.only(top: 12), child: Text('Showing the nearest 50. Zoom in to see the rest.', style: T.body(14, color: C.muted))),
      ]);

  Widget _row(_Row row, {required bool first}) {
    final b = row.bay;
    final meta = '${b.kw} kW · ${classLabel(b.cls)} · from ${formatEuro(b.priceFromCents)}${row.distance == null ? '' : ' · ${formatDistance(row.distance!)}'}';
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(border: first ? null : const Border(top: BorderSide(color: C.line))),
      child: Row(children: [
        Expanded(
          child: InkWell(
            borderRadius: BorderRadius.circular(8),
            onTap: () => onSelect(b.id),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 44),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(children: [
                  b.offline ? Semantics(label: 'Offline', child: const Icon(LucideIcons.wifiOff, size: 14, color: C.danger)) : Led(b.green),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(b.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: T.body(16, weight: FontWeight.w500)),
                      Text.rich(
                        TextSpan(children: [
                          if (b.status != 'free')
                            TextSpan(text: '${bayStatus[b.status]?.label ?? b.status} · ', style: const TextStyle(fontWeight: FontWeight.w600, color: C.warn)),
                          TextSpan(text: meta),
                        ]),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: T.mono(13, em: 0, color: C.muted),
                      ),
                    ]),
                  ),
                ]),
              ),
            ),
          ),
        ),
        const SizedBox(width: 12),
        Semantics(
          label: 'Book ${b.name} now',
          excludeSemantics: true,
          child: Btn('Book now', variant: BtnVariant.secondary, size: BtnSize.sm, onPressed: b.offline ? null : () => onBook(b)),
        ),
      ]),
    );
  }
}

// Any bay, real or GoingElectric: what it is, the LED, Book, Navigate, and walk-up when it's green
class _BayPanel extends StatefulWidget {
  const _BayPanel({super.key, required this.bay, required this.distance, required this.onBack, required this.onBook});
  final Bay bay;
  final double? distance;
  final VoidCallback onBack;
  final ValueChanged<Bay> onBook;
  @override
  State<_BayPanel> createState() => _BayPanelState();
}

class _BayPanelState extends State<_BayPanel> {
  bool _unlocking = false;
  String _error = '';
  ({String key, int cents})? _fee;
  String? _asked;

  // "Book now" books this moment, from the block under way for at least an hour (nowSlot): the button says until
  // when, and the fee. A new block or demand level can change the price, so it's asked again per key.
  void _quote(String key) {
    if (_asked == key) return;
    _asked = key;
    api.quoteNow(widget.bay.id).then((q) {
      if (mounted) setState(() => _fee = (key: key, cents: q.cents));
    }, onError: (_) {});
  }

  // walk-up needs evidence of being at the bay: the geofence (and, at real bays, the camera seeing the car)
  Future<void> _unlock() async {
    setState(() {
      _unlocking = true;
      _error = '';
    });
    try {
      final at = await locate();
      final r = await api.unlock(widget.bay.id, at);
      if (!mounted) return;
      setState(() => _unlocking = false);
      await openBooking(context, r.id);
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = '$e';
          _unlocking = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final b = widget.bay;
    final s = bayStatus[b.status] ?? (label: b.status, bg: C.sunken, fg: C.ink);
    final until = freeUntil(b);
    final canWalkUp = b.green && b.status == 'free';
    final simulatedNote = b.guard == 'simulated'
        ? (b.real ? ' No hardware is assigned to this bay yet, so its guard is simulated.' : ' This charger’s guard is simulated for the demo.')
        : '';

    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: TextButton.icon(
          onPressed: widget.onBack,
          style: TextButton.styleFrom(
            minimumSize: const Size(0, 44),
            padding: const EdgeInsets.symmetric(horizontal: 12),
            foregroundColor: C.muted,
            shape: const StadiumBorder(),
          ),
          icon: const Icon(LucideIcons.arrowLeft, size: 16),
          label: Text('All chargers', style: T.body(16, weight: FontWeight.w600, color: C.muted)),
        ),
      ),
      Wrap(spacing: 8, runSpacing: 8, children: [
        StatusChip(s.label, bg: s.bg, fg: s.fg, leading: b.offline ? null : Led(b.green)),
        if (b.real)
          StatusChip(hardwareNote(b.guard, b.real), bg: b.guard == 'hardware' ? C.sunken : C.accentTint, fg: b.guard == 'hardware' ? C.ink : C.accent),
      ]),
      if (b.network != null) ...[const SizedBox(height: 16), SectionLabel(b.network!)],
      const SizedBox(height: 8),
      Text(b.name, style: T.display(36)),
      const SizedBox(height: 4),
      Text('${b.address}${widget.distance == null ? '' : ' · ${formatDistance(widget.distance!)} away'}', style: T.body(16, color: C.muted)),
      const SizedBox(height: 20),
      for (final p in b.points)
        Container(
          margin: const EdgeInsets.only(bottom: 8),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(color: C.sunken, borderRadius: BorderRadius.circular(8)),
          child: Row(children: [
            Expanded(child: Text('${p.count}× ${p.type}', style: T.body(16, weight: FontWeight.w500))),
            Text('${_kw(p.power)} kW', style: T.mono(15, em: 0, color: C.muted)),
          ]),
        ),
      const SizedBox(height: 12),
      Text.rich(
        TextSpan(children: [
          TextSpan(text: '${classLabel(b.cls)}: from '),
          TextSpan(text: formatEuro(b.priceFromCents), style: T.mono(14, weight: FontWeight.w600, em: 0, color: C.ink)),
          TextSpan(text: ' to reserve; the fee is set by demand when you book.$simulatedNote'),
        ]),
        style: T.body(14, color: C.muted),
      ),
      if (b.offline) ...[const SizedBox(height: 16), Note.text(offlineText, tone: NoteTone.warn, icon: LucideIcons.wifiOff, bold: true)],
      if (b.status == 'occupied') ...[
        const SizedBox(height: 16),
        const Note(
          Text.rich(TextSpan(children: [
            TextSpan(text: 'A car is in the bay right now.', style: TextStyle(fontWeight: FontWeight.w600)),
            TextSpan(text: ' You can still book a later start.'),
          ])),
          tone: NoteTone.warn,
          icon: LucideIcons.carFront,
        ),
      ],
      const SizedBox(height: 20),
      NowBuilder(builder: (context, now) {
        final slot = nowSlot(b.cls, now);
        final key = '${b.id}:${slot.start}:${b.priceFromCents}';
        _quote(key);
        final fee = _fee?.key == key ? ' · ${formatEuro(_fee!.cents)}' : '';
        return Btn(
          'Book now · until ${formatTime(slot.start + slot.blocks * blockMs)}$fee',
          size: BtnSize.lg,
          expand: true,
          onPressed: b.offline ? null : () => widget.onBook(b),
        );
      }),
      const SizedBox(height: 12),
      Btn('Navigate by car', variant: BtnVariant.secondary, size: BtnSize.lg, icon: LucideIcons.navigation, onPressed: () => openUrl(directionsUrl(b.point))),
      if (canWalkUp) ...[
        const SizedBox(height: 24),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(color: C.brandTint, borderRadius: BorderRadius.circular(16)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Btn(
              until != null ? 'Unlock now: free until $until' : 'Unlock now: nothing booked after you',
              variant: BtnVariant.secondary,
              size: BtnSize.lg,
              icon: LucideIcons.lockOpen,
              loading: _unlocking,
              expand: true,
              onPressed: _unlock,
            ),
            const SizedBox(height: 8),
            Text(
              'No booking needed while it’s green. You need to be at the bay${b.real ? ', with your car in front of the camera' : ''}.',
              style: T.body(14, color: C.ink),
            ),
          ]),
        ),
      ],
      if (b.url != null) ...[
        const SizedBox(height: 20),
        InkWell(
          onTap: () => openUrl(Uri.parse(b.url!)),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 44),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Text(
                'This charger on GoingElectric',
                style: T.body(14, weight: FontWeight.w600, color: C.accent).copyWith(decoration: TextDecoration.underline, decorationColor: C.accent),
              ),
              const SizedBox(width: 6),
              const Icon(LucideIcons.externalLink, size: 16, color: C.accent),
            ]),
          ),
        ),
      ],
      if (b.guard == 'simulated') ...[
        const SizedBox(height: 16),
        Row(children: [
          const Icon(LucideIcons.flaskConical, size: 14, color: C.accent),
          const SizedBox(width: 8),
          Text(hardwareNote(b.guard, b.real).toUpperCase(), style: T.mono(12, em: 0.08, color: C.accent)),
        ]),
      ],
      if (_error.isNotEmpty) ...[const SizedBox(height: 16), ErrorNote(_error)],
    ]);
  }
}
