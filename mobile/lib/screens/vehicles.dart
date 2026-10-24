import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../api.dart';
import '../app_state.dart';
import '../format.dart';
import '../theme.dart';
import '../ui.dart';

// The driver's cars (web/components/vehicles/vehicles.tsx), and the first step after sign-up (welcome.tsx)

const _max = 5;

class VehiclesScreen extends StatefulWidget {
  const VehiclesScreen({super.key});
  @override
  State<VehiclesScreen> createState() => _VehiclesScreenState();
}

class _VehiclesScreenState extends State<VehiclesScreen> {
  List<Vehicle>? _cars;
  bool _adding = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _load();
    // a car added elsewhere (the booking flow, the welcome screen) shows when this tab opens
    currentTab.addListener(_onTab);
  }

  @override
  void dispose() {
    currentTab.removeListener(_onTab);
    super.dispose();
  }

  void _onTab() {
    if (currentTab.value == AppTab.vehicles) _load();
  }

  Future<void> _load() async {
    try {
      final cars = await api.vehicles();
      if (mounted) {
        setState(() {
          _cars = cars;
          _error = '';
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  void _confirmRemove(Vehicle v) => showSheet<void>(
        context,
        title: 'Delete this car?',
        builder: (_) => _RemoveSheet(
          car: v,
          onRemoved: () => setState(() => _cars = _cars?.where((c) => c.id != v.id).toList()),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final cars = _cars;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 32, 20, 48),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 720),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Wrap(spacing: 16, runSpacing: 16, alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.end, children: [
              Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                Text('Your cars', style: T.display(40)),
                const SizedBox(height: 4),
                Text('The camera at a reserved bay uses these plates to let you in.', style: T.body(16, color: C.muted)),
              ]),
              if (cars != null && cars.isNotEmpty && cars.length < _max && !_adding)
                Btn('Add a car', variant: BtnVariant.secondary, icon: LucideIcons.plus, onPressed: () => setState(() => _adding = true)),
            ]),
            if (_error.isNotEmpty) ...[const SizedBox(height: 16), Text(_error, style: T.body(16, color: C.danger))],
            const SizedBox(height: 32),
            if (cars == null && _error.isEmpty) const Skeleton(height: 112),
            if (cars != null && cars.isEmpty) ...[
              const EmptyState(
                icon: LucideIcons.carFront,
                title: 'No cars yet',
                body: 'Add the car you drive. You agree to plate recognition once, per car.',
              ),
              const SizedBox(height: 16),
            ],
            for (final c in cars ?? const <Vehicle>[]) ...[
              Panel(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  PlateBadge(c.display, size: PlateSize.lg),
                  const SizedBox(height: 12),
                  Row(children: [
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(c.label, maxLines: 1, overflow: TextOverflow.ellipsis, style: T.body(18, weight: FontWeight.w600)),
                        const SizedBox(height: 2),
                        Text('Plate recognition on · since ${formatDay(c.consentAt)}'.toUpperCase(), style: T.mono(12, color: C.muted)),
                      ]),
                    ),
                    Semantics(
                      label: 'Delete ${c.label}',
                      excludeSemantics: true,
                      child: Btn('Delete', variant: BtnVariant.ghost, icon: LucideIcons.trash2, onPressed: () => _confirmRemove(c)),
                    ),
                  ]),
                ]),
              ),
              const SizedBox(height: 16),
            ],
            if (cars != null && (cars.isEmpty || _adding))
              Panel(
                padding: const EdgeInsets.all(24),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Text('Add a car', style: T.display(32, height: 1)),
                  const SizedBox(height: 20),
                  VehicleForm(
                    onAdded: (v) => setState(() {
                      _cars = [...?_cars, v];
                      _adding = false;
                    }),
                  ),
                ]),
              ),
            if (cars != null && cars.length >= _max) Text('You can add up to $_max cars.', style: T.body(14, color: C.muted)),
          ]),
        ),
      ),
    );
  }
}

class _RemoveSheet extends StatefulWidget {
  const _RemoveSheet({required this.car, required this.onRemoved});
  final Vehicle car;
  final VoidCallback onRemoved;
  @override
  State<_RemoveSheet> createState() => _RemoveSheetState();
}

class _RemoveSheetState extends State<_RemoveSheet> {
  bool _busy = false;
  String _error = '';

  Future<void> _remove() async {
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      await api.removeVehicle(widget.car.id);
      widget.onRemoved();
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = '$e';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          PlateBadge(widget.car.display),
          const SizedBox(width: 12),
          Expanded(child: Text(widget.car.label, style: T.body(16, weight: FontWeight.w600))),
        ]),
        const SizedBox(height: 16),
        Text('Its plate is deleted from your account. A booking that’s already running keeps working until it ends.', style: T.body(16, color: C.muted)),
        if (_error.isNotEmpty) ...[const SizedBox(height: 16), ErrorNote(_error)],
        const SizedBox(height: 24),
        Wrap(spacing: 12, runSpacing: 12, children: [
          Btn('Delete car', variant: BtnVariant.danger, size: BtnSize.lg, loading: _busy, onPressed: _remove),
          Btn('Keep it', variant: BtnVariant.secondary, size: BtnSize.lg, onPressed: () => Navigator.of(context).pop()),
        ]),
      ]);
}

const _facts = [
  (LucideIcons.scanLine, 'At a Baywatch bay, the camera reads your plate and lowers the guard for you.'),
  (LucideIcons.userCheck, 'It only compares the plate with your own booking.'),
  (LucideIcons.eyeOff, 'Each booking forgets the plate when it ends. Delete the car any time.'),
];

/// First step after sign-up: the plate is what lets the driver into a reserved bay
class WelcomeScreen extends StatefulWidget {
  const WelcomeScreen({super.key});
  @override
  State<WelcomeScreen> createState() => _WelcomeScreenState();
}

class _WelcomeScreenState extends State<WelcomeScreen> {
  List<Vehicle>? _cars;

  @override
  void initState() {
    super.initState();
    api.vehicles().then((c) => mounted ? setState(() => _cars = c) : null, onError: (_) => mounted ? setState(() => _cars = []) : null);
  }

  void _explore() => goTab(context, AppTab.explore);

  @override
  Widget build(BuildContext context) {
    final cars = _cars;
    return Scaffold(
      appBar: AppBar(
        backgroundColor: C.page,
        surfaceTintColor: C.page,
        titleSpacing: 0,
        title: const Logo(),
        shape: const Border(bottom: BorderSide(color: C.line)),
      ),
      body: SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 32, 20, 48),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 720),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                // the product's one eyebrow (web/DESIGN.md: The One Eyebrow Rule)
                Row(children: [
                  Container(width: 24, height: 1, color: C.accent.withValues(alpha: 0.7)),
                  const SizedBox(width: 12),
                  Text('WELCOME TO BAYWATCH', style: T.mono(13, em: 0.16, color: C.accent)),
                ]),
                const SizedBox(height: 12),
                Text('Add your car', style: T.display(60, height: 0.9)),
                const SizedBox(height: 16),
                ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 420),
                  child: Text('It takes a minute, and it’s how a reserved bay knows to let you in.', style: T.body(18, color: C.muted)),
                ),
                const SizedBox(height: 24),
                const Align(alignment: Alignment.centerLeft, child: BaySketch(Scene.arriving, width: 256)),
                const SizedBox(height: 24),
                for (final (icon, text) in _facts)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Icon(icon, size: 20, color: C.ink),
                      const SizedBox(width: 12),
                      Expanded(child: Text(text, style: T.body(16, color: C.muted))),
                    ]),
                  ),
                const SizedBox(height: 16),
                Panel(
                  padding: const EdgeInsets.all(24),
                  child: cars == null
                      ? const Skeleton(height: 320)
                      : cars.isNotEmpty
                          ? Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text('You’re all set', style: T.display(32, height: 1)),
                              const SizedBox(height: 16),
                              Wrap(spacing: 12, runSpacing: 12, children: [for (final c in cars) PlateBadge(c.display)]),
                              const SizedBox(height: 24),
                              Btn('Find a charger', size: BtnSize.lg, onPressed: _explore),
                            ])
                          : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                              VehicleForm(submitLabel: 'Add car and find a bay', onAdded: (_) => _explore()),
                              const SizedBox(height: 16),
                              Align(
                                alignment: Alignment.centerLeft,
                                child: TextButton(
                                  onPressed: _explore,
                                  child: Text(
                                    'Skip for now',
                                    style: T.body(14, weight: FontWeight.w600, color: C.muted).copyWith(decoration: TextDecoration.underline),
                                  ),
                                ),
                              ),
                            ]),
                ),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}
