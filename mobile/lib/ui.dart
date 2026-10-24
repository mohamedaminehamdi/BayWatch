import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:url_launcher/url_launcher.dart';

import 'api.dart';
import 'format.dart';
import 'theme.dart';

// The shared parts every screen is built from, ported from web/components/ui/* and the small shared pieces of
// web/components/booking and web/components/explore. Same names as the web where there is one.

// ── copy shared by several screens ──

typedef Tone = ({String label, Color bg, Color fg});

// What a bay is doing, in words: the LED is never the only sign (explore/panels.tsx STATUS)
const bayStatus = <String, Tone>{
  'free': (label: 'Free', bg: C.brandTint, fg: C.brandStrong),
  'reserved': (label: 'Reserved', bg: C.warnTint, fg: C.warn),
  'occupied': (label: 'Car in bay', bg: C.warnTint, fg: C.warn),
  'offline': (label: 'Offline', bg: C.warnTint, fg: C.warn),
};

const offlineText = 'The bay is offline right now. Try again in a few minutes.';

// The three Baywatch bays say honestly whether a real barrier stands behind them
String hardwareNote(String guard, bool real) => guard == 'hardware' ? 'Real barrier' : real ? 'No hardware assigned yet' : 'Demo: simulated guard';

// bw-1 and bw-2 are real locks: the barrier rises 10 minutes before the slot, or at once for a slot that close
String barrierNote(int start, int now) =>
    start - armMs > now ? 'The barrier goes up at ${formatTime(start - armMs)}, ${armMs ~/ minute} minutes before your slot.' : 'The barrier goes up now.';

// A walk-up can run until the next booking's start, less the gap; with nothing booked, all day
String? freeUntil(Bay b) => b.nextBookingAt == null ? null : formatTime(b.nextBookingAt! - minGapMs);

Future<void> openUrl(Uri uri) => launchUrl(uri, mode: LaunchMode.externalApplication);

/// The device's position, used once (check-in, walk-up, "Locate me") and never stored
Future<Point> locate() async {
  if (!await Geolocator.isLocationServiceEnabled()) throw ApiException('Location is off. Turn it on to continue.');
  var p = await Geolocator.checkPermission();
  if (p == LocationPermission.denied) p = await Geolocator.requestPermission();
  if (p == LocationPermission.denied || p == LocationPermission.deniedForever) {
    throw ApiException('Allow location access so we can check you’re at the bay.');
  }
  final pos = await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 10)));
  return (lat: pos.latitude, lng: pos.longitude);
}

// ── buttons and chips ──

enum BtnVariant { primary, secondary, ghost, danger, signal, onBrand }

enum BtnSize { sm, md, lg }

/// Ecurious's mono-capital pills. Every size is at least 44 px tall (the touch-target floor in web/PRODUCT.md).
class Btn extends StatelessWidget {
  const Btn(
    this.label, {
    super.key,
    this.onPressed,
    this.icon,
    this.trailingIcon,
    this.variant = BtnVariant.primary,
    this.size = BtnSize.md,
    this.loading = false,
    this.expand = false,
  });
  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final IconData? trailingIcon; // only forward actions get an arrow (web/DESIGN.md voice rule 6)
  final BtnVariant variant;
  final BtnSize size;
  final bool loading, expand;

  @override
  Widget build(BuildContext context) {
    final (bg, fg, edge) = switch (variant) {
      BtnVariant.primary => (C.brand, C.onBrand, null),
      // the edge is line-strong (3:1), so the button still reads as one in glare
      BtnVariant.secondary => (C.surface, C.ink, C.lineStrong),
      BtnVariant.ghost => (Colors.transparent, C.ink, null),
      BtnVariant.danger => (C.danger, Colors.white, null),
      BtnVariant.signal => (C.signal, C.ink, null),
      BtnVariant.onBrand => (Colors.transparent, C.onBrand, C.onBrandMuted.withValues(alpha: 0.5)),
    };
    final (h, px, fs) = switch (size) {
      BtnSize.sm => (44.0, 16.0, 12.0),
      BtnSize.md => (44.0, 24.0, 14.0),
      BtnSize.lg => (52.0, 32.0, 15.0),
    };
    final off = onPressed == null || loading;
    final shape = StadiumBorder(side: edge == null ? BorderSide.none : BorderSide(color: edge));
    return Opacity(
      opacity: off ? 0.55 : 1,
      child: Material(
        color: bg,
        shape: shape,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: off ? null : onPressed,
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: h),
            child: Padding(
              padding: EdgeInsets.symmetric(horizontal: px, vertical: 10),
              child: Row(
                mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (loading) ...[SizedBox.square(dimension: 16, child: CircularProgressIndicator(strokeWidth: 2, color: fg)), const SizedBox(width: 10)],
                  if (icon != null && !loading) ...[Icon(icon, size: size == BtnSize.lg ? 20 : 18, color: fg), const SizedBox(width: 10)],
                  Flexible(
                    child: Text(label.toUpperCase(), textAlign: TextAlign.center, style: T.mono(fs, weight: FontWeight.w600, em: 0.06, color: fg)),
                  ),
                  if (trailingIcon != null) ...[const SizedBox(width: 10), Icon(trailingIcon, size: size == BtnSize.lg ? 20 : 18, color: fg)],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Status labels: mono capitals in a pill. Always a word with the tone, never colour alone.
class StatusChip extends StatelessWidget {
  const StatusChip(this.label, {super.key, this.bg = C.sunken, this.fg = C.ink, this.leading});
  StatusChip.tone(Tone t, {super.key, this.leading})
      : label = t.label,
        bg = t.bg,
        fg = t.fg;
  final String label;
  final Color bg, fg;
  final Widget? leading;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: ShapeDecoration(color: bg, shape: const StadiumBorder()),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          if (leading != null) ...[leading!, const SizedBox(width: 6)],
          // wraps on a narrow screen rather than overflowing ("Includes simulated data")
          Flexible(child: Text(label.toUpperCase(), style: T.mono(13, weight: FontWeight.w600, em: 0.08, color: fg))),
        ]),
      );
}

/// The bay's virtual LED: green (lime, ringed in ink) can be unlocked now; red is reserved soon or occupied
class Led extends StatelessWidget {
  const Led(this.green, {super.key, this.onDark = false, this.size = 10});
  final bool green, onDark;
  final double size;
  @override
  Widget build(BuildContext context) => Semantics(
        label: green ? 'LED green: can be unlocked now' : 'LED red: reserved soon or occupied',
        child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            color: green ? C.signal : C.danger,
            shape: BoxShape.circle,
            border: Border.all(color: onDark ? C.onBrand.withValues(alpha: 0.8) : C.ink, width: 2),
          ),
        ),
      );
}

/// A small pulsing dot, for live states (the web's animate-ping dots)
class LiveDot extends StatefulWidget {
  const LiveDot({super.key, this.color = C.brand, this.size = 8});
  final Color color;
  final double size;
  @override
  State<LiveDot> createState() => _LiveDotState();
}

class _LiveDotState extends State<LiveDot> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1000))..repeat();
  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => SizedBox.square(
        dimension: widget.size,
        child: Stack(alignment: Alignment.center, clipBehavior: Clip.none, children: [
          AnimatedBuilder(
            animation: _c,
            builder: (_, _) => Transform.scale(
              scale: 1 + _c.value,
              child: Opacity(
                opacity: (1 - _c.value) * 0.75,
                child: Container(decoration: BoxDecoration(color: widget.color, shape: BoxShape.circle)),
              ),
            ),
          ),
          Container(decoration: BoxDecoration(color: widget.color, shape: BoxShape.circle)),
        ]),
      );
}

// ── the licence plate ──

enum PlateSize { sm, md, lg }

/// A German/EU-style licence plate: blue band with the EU stars and country code, black on white
class PlateBadge extends StatelessWidget {
  const PlateBadge(this.plate, {super.key, this.size = PlateSize.md});
  final String plate;
  final PlateSize size;
  @override
  Widget build(BuildContext context) {
    final fs = switch (size) { PlateSize.sm => 16.0, PlateSize.md => 20.0, PlateSize.lg => 30.0 };
    return Semantics(
      label: 'License plate $plate',
      excludeSemantics: true,
      child: Container(
        decoration: BoxDecoration(color: Colors.white, border: Border.all(color: C.ink, width: 2), borderRadius: BorderRadius.circular(6)),
        clipBehavior: Clip.antiAlias,
        child: IntrinsicHeight(
          child: Row(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Container(
              color: C.plateBlue,
              padding: EdgeInsets.fromLTRB(fs * 0.2, fs * 0.2, fs * 0.2, fs * 0.08),
              child: Column(mainAxisAlignment: MainAxisAlignment.end, children: [
                CustomPaint(size: Size.square(fs * 0.55), painter: _StarsPainter()),
                SizedBox(height: fs * 0.05),
                Text('D', style: T.display(fs * 0.5, color: Colors.white, height: 1)),
              ]),
            ),
            Padding(
              padding: EdgeInsets.symmetric(horizontal: fs * 0.4, vertical: fs * 0.2),
              child: Center(
                widthFactor: 1,
                child: Text(plate.toUpperCase(), style: T.display(fs, color: C.ink, height: 1).copyWith(letterSpacing: fs * 0.08)),
              ),
            ),
          ]),
        ),
      ),
    );
  }
}

class _StarsPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size s) {
    final p = Paint()..color = C.plateStar;
    final r = s.width * 0.36;
    for (var i = 0; i < 12; i++) {
      final a = i / 12 * math.pi * 2;
      canvas.drawCircle(Offset(s.width / 2 + r * math.cos(a), s.height / 2 + r * math.sin(a)), s.width * 0.055, p);
    }
  }

  @override
  bool shouldRepaint(_) => false;
}

// ── surfaces ──

/// A white card with a hairline ring, the web's `rounded-2xl bg-surface p-6 ring-1 ring-line`
class Panel extends StatelessWidget {
  const Panel({super.key, required this.child, this.padding = const EdgeInsets.all(20), this.color = C.surface, this.radius = 16, this.ring = C.line});
  final Widget child;
  final EdgeInsets padding;
  final Color color;
  final double radius;
  final Color? ring;
  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: padding,
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(radius),
          border: ring == null ? null : Border.all(color: ring!),
        ),
        child: child,
      );
}

enum NoteTone { info, warn, danger, sunken, brand }

/// A banner: icon and text on a tint (info is violet, warn orange, danger red)
class Note extends StatelessWidget {
  const Note(this.child, {super.key, this.tone = NoteTone.info, this.icon, this.bold = false});
  final Widget child;
  final NoteTone tone;
  final IconData? icon;
  final bool bold;
  Note.text(String text, {super.key, this.tone = NoteTone.info, this.icon, this.bold = false}) : child = Text(text);

  @override
  Widget build(BuildContext context) {
    final (bg, iconColor, fg) = switch (tone) {
      NoteTone.info => (C.accentTint, C.accent, C.ink),
      NoteTone.warn => (C.warnTint, C.warn, C.ink),
      NoteTone.danger => (C.dangerTint, C.danger, C.danger),
      NoteTone.sunken => (C.sunken, C.accent, C.ink),
      NoteTone.brand => (C.brandTint, C.ink, C.ink),
    };
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(16)),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (icon != null) ...[Padding(padding: const EdgeInsets.only(top: 1), child: Icon(icon, size: 20, color: iconColor)), const SizedBox(width: 12)],
        Expanded(child: DefaultTextStyle.merge(style: T.body(15, color: fg, weight: bold ? FontWeight.w600 : FontWeight.w500), child: child)),
      ]),
    );
  }
}

/// An error from the server, in its own words
class ErrorNote extends StatelessWidget {
  const ErrorNote(this.message, {super.key});
  final String message;
  @override
  Widget build(BuildContext context) => Note.text(message, tone: NoteTone.danger, icon: LucideIcons.triangleAlert);
}

/// A placeholder while data loads (the web's animate-pulse blocks)
class Skeleton extends StatelessWidget {
  const Skeleton({super.key, this.height = 96, this.radius = 16});
  final double height, radius;
  @override
  Widget build(BuildContext context) => Container(height: height, decoration: BoxDecoration(color: C.sunken, borderRadius: BorderRadius.circular(radius)));
}

/// Mono capitals over a list: "DEMO BAYS", "UPCOMING"
class SectionLabel extends StatelessWidget {
  const SectionLabel(this.text, {super.key, this.color = C.muted});
  final String text;
  final Color color;
  @override
  Widget build(BuildContext context) => Text(text.toUpperCase(), style: T.mono(12, color: color, em: 0.12));
}

/// For screens with nothing to show yet: says what will appear here and how to get it
class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, required this.body, this.action});
  final IconData icon;
  final String title, body;
  final Widget? action;
  @override
  Widget build(BuildContext context) => CustomPaint(
        painter: _DashedRRect(color: C.lineStrong, radius: 16),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 48),
          decoration: BoxDecoration(color: C.surface, borderRadius: BorderRadius.circular(16)),
          child: Column(children: [
            Container(
              width: 48,
              height: 48,
              decoration: const BoxDecoration(color: C.brandTint, shape: BoxShape.circle),
              child: Icon(icon, size: 24, color: C.ink),
            ),
            const SizedBox(height: 20),
            Text(title, textAlign: TextAlign.center, style: T.display(30, height: 1)),
            const SizedBox(height: 8),
            ConstrainedBox(constraints: const BoxConstraints(maxWidth: 380), child: Text(body, textAlign: TextAlign.center, style: T.body(16, color: C.muted))),
            if (action != null) ...[const SizedBox(height: 24), action!],
          ]),
        ),
      );
}

class _DashedRRect extends CustomPainter {
  _DashedRRect({required this.color, required this.radius});
  final Color color;
  final double radius;
  @override
  void paint(Canvas canvas, Size size) {
    final path = Path()..addRRect(RRect.fromRectAndRadius(Offset.zero & size, Radius.circular(radius)));
    canvas.drawPath(dashed(path, 5, 4), Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1);
  }

  @override
  bool shouldRepaint(_) => false;
}

Path dashed(Path source, double dash, double gap) {
  final out = Path();
  for (final m in source.computeMetrics()) {
    for (var d = 0.0; d < m.length; d += dash + gap) {
      out.addPath(m.extractPath(d, math.min(d + dash, m.length)), Offset.zero);
    }
  }
  return out;
}

/// The web's Dialog: on phones it sits at the bottom, with a title and a close button
Future<R?> showSheet<R>(BuildContext context, {required String title, required WidgetBuilder builder}) => showModalBottomSheet<R>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: C.surface,
      barrierColor: C.ink.withValues(alpha: 0.45),
      constraints: const BoxConstraints(maxWidth: 560),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => SheetFrame(title: title, child: builder(ctx)),
    );

class SheetFrame extends StatelessWidget {
  const SheetFrame({super.key, required this.title, required this.child});
  final String title;
  final Widget child;
  @override
  Widget build(BuildContext context) {
    final mq = MediaQuery.of(context);
    return ConstrainedBox(
      constraints: BoxConstraints(maxHeight: mq.size.height * 0.92),
      child: Padding(
        padding: EdgeInsets.only(bottom: mq.viewInsets.bottom),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Container(
            padding: const EdgeInsets.fromLTRB(24, 10, 10, 10),
            decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: C.line))),
            child: Row(children: [
              Expanded(child: Text(title, style: T.display(26, height: 1))),
              IconButton(
                tooltip: 'Close',
                onPressed: () => Navigator.of(context).pop(),
                icon: const Icon(LucideIcons.x, size: 20, color: C.muted),
                style: IconButton.styleFrom(minimumSize: const Size.square(44)),
              ),
            ]),
          ),
          Flexible(child: SingleChildScrollView(padding: EdgeInsets.fromLTRB(24, 20, 24, 24 + mq.padding.bottom), child: child)),
        ]),
      ),
    );
  }
}

// ── forms ──

/// A label over its input, with an optional hint under it
class Field extends StatelessWidget {
  const Field({super.key, required this.label, required this.child, this.hint});
  final String label;
  final Widget child;
  final String? hint;
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(label, style: T.body(16, weight: FontWeight.w600)),
        const SizedBox(height: 6),
        child,
        if (hint != null) ...[const SizedBox(height: 6), Text(hint!, style: T.body(14, color: C.muted))],
      ]);
}

final upperCase = TextInputFormatter.withFunction((_, v) => v.copyWith(text: v.text.toUpperCase()));

/// A licence plate input: mono capitals, as the web's
class PlateField extends StatelessWidget {
  const PlateField({super.key, required this.controller, this.onChanged, this.hint = 'M AB 1234'});
  final TextEditingController controller;
  final ValueChanged<String>? onChanged;
  final String hint;
  @override
  Widget build(BuildContext context) => TextField(
        controller: controller,
        onChanged: onChanged,
        maxLength: 14,
        autocorrect: false,
        enableSuggestions: false,
        textCapitalization: TextCapitalization.characters,
        inputFormatters: [upperCase],
        style: T.mono(18, weight: FontWeight.w600, em: 0.06, color: C.ink),
        decoration: InputDecoration(hintText: hint, counterText: ''),
      );
}

/// A tick box on paper-2, for consent and accepting fees
class ConsentBox extends StatelessWidget {
  const ConsentBox({super.key, required this.value, required this.onChanged, required this.child, this.plain = false});
  final bool value;
  final ValueChanged<bool> onChanged;
  final Widget child;
  final bool plain; // no background: "I accept these fees"
  @override
  Widget build(BuildContext context) => Material(
        color: plain ? Colors.transparent : C.sunken,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () => onChanged(!value),
          child: Padding(
            padding: plain ? const EdgeInsets.symmetric(vertical: 6) : const EdgeInsets.all(12),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              SizedBox.square(dimension: 28, child: Checkbox(value: value, onChanged: (v) => onChanged(v ?? false))),
              const SizedBox(width: 8),
              Expanded(child: Padding(padding: const EdgeInsets.only(top: 4), child: DefaultTextStyle.merge(style: T.body(15.5), child: child))),
            ]),
          ),
        ),
      );
}

/// Add a car: plate, nickname, and consent to plate recognition (asked once, per car). web/components/vehicles/vehicle-form.tsx
class VehicleForm extends StatefulWidget {
  const VehicleForm({super.key, required this.onAdded, this.submitLabel = 'Add car'});
  final ValueChanged<Vehicle> onAdded;
  final String submitLabel;
  @override
  State<VehicleForm> createState() => _VehicleFormState();
}

class _VehicleFormState extends State<VehicleForm> {
  final _plate = TextEditingController();
  final _label = TextEditingController();
  bool _consent = false, _busy = false;
  String _error = '';

  @override
  void dispose() {
    _plate.dispose();
    _label.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      final v = await api.addVehicle(plate: _plate.text, label: _label.text, consent: _consent);
      _plate.clear();
      _label.clear();
      _consent = false;
      widget.onAdded(v);
    } catch (e) {
      _error = '$e';
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final plate = _plate.text.trim();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Field(label: 'License plate', hint: 'As it is on the plate, for example M AB 1234', child: PlateField(controller: _plate, onChanged: (_) => setState(() {}))),
      if (plate.isNotEmpty) ...[const SizedBox(height: 12), Align(alignment: Alignment.centerLeft, child: ExcludeSemantics(child: PlateBadge(plate)))],
      const SizedBox(height: 20),
      Field(
        label: 'Nickname (optional)',
        child: TextField(controller: _label, maxLength: 30, decoration: const InputDecoration(hintText: 'Blue Zoe', counterText: '')),
      ),
      const SizedBox(height: 20),
      ConsentBox(
        value: _consent,
        onChanged: (v) => setState(() => _consent = v),
        child: const Text.rich(TextSpan(children: [
          TextSpan(text: 'Use this plate to check me in at Baywatch bays. ', style: TextStyle(fontWeight: FontWeight.w600)),
          TextSpan(text: 'The camera compares what it reads with your booking only. Each booking forgets the plate when it ends, and you can delete this car at any time.'),
        ])),
      ),
      if (_error.isNotEmpty) ...[const SizedBox(height: 16), Text(_error, style: T.body(15, color: C.danger))],
      const SizedBox(height: 20),
      Btn(widget.submitLabel, size: BtnSize.lg, loading: _busy, onPressed: plate.isEmpty || !_consent ? null : _submit),
    ]);
  }
}

// ── booking pieces used on several screens ──

/// What cancelling costs over time, as steps: free, 10 %, 50 %, 80 %, then the no-show (100 %).
/// web/components/booking/cancel-schedule.tsx
class CancelSchedule extends StatelessWidget {
  const CancelSchedule({super.key, required this.steps, required this.noShowCents, required this.now});
  final List<CancelStep> steps;
  final int noShowCents, now;

  static Color _tone(int percent) => percent == 0 ? C.brandTint : percent < 50 ? C.sunken : percent < 100 ? C.warnTint : C.dangerTint;

  String _when(int at) => at <= now ? 'Now' : '${sameDay(at, now) ? '' : '${formatDay(at)}, '}${formatTime(at)}';

  @override
  Widget build(BuildContext context) {
    final rows = [
      for (final s in steps) (label: s.percent == 0 ? 'Free' : '${s.percent}%', cents: s.cents, from: 'from ${_when(s.from)}', percent: s.percent),
      (label: 'No-show', cents: noShowCents, from: 'After the arrival deadline', percent: 100),
    ];
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text('If you cancel', style: T.body(16, weight: FontWeight.w600)),
      const SizedBox(height: 12),
      // a picture of the list below, which carries the same information in words
      ExcludeSemantics(
        child: ClipRRect(
          borderRadius: BorderRadius.circular(99),
          child: SizedBox(
            height: 8,
            child: Row(children: [
              for (var i = 0; i < rows.length; i++) ...[
                if (i > 0) Container(width: 2, color: C.surface),
                Expanded(child: Container(color: _tone(rows[i].percent))),
              ],
            ]),
          ),
        ),
      ),
      const SizedBox(height: 12),
      for (final r in rows)
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Row(children: [
            Container(
              constraints: const BoxConstraints(minWidth: 68),
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: ShapeDecoration(color: _tone(r.percent), shape: const StadiumBorder()),
              child: Text(r.label.toUpperCase(), textAlign: TextAlign.center, style: T.mono(12, weight: FontWeight.w600, em: 0.06, color: C.ink)),
            ),
            const SizedBox(width: 8),
            Expanded(child: Text(r.from, style: T.body(14, color: C.muted))),
            Text(formatEuro(r.cents), style: T.mono(14, weight: FontWeight.w600, em: 0, color: C.ink)),
          ]),
        ),
    ]);
  }
}

/// Free chargers to go to instead of an occupied bay: book one, or drive there. web/components/booking/alternatives.tsx
class AlternativeList extends StatelessWidget {
  const AlternativeList({super.key, required this.bays, required this.onBook, this.from});
  final List<Bay> bays;
  final Point? from;
  final ValueChanged<Bay> onBook;
  @override
  Widget build(BuildContext context) {
    if (bays.isEmpty) return Text('No other free chargers nearby right now.', style: T.body(15, color: C.muted));
    return Column(children: [
      for (var i = 0; i < bays.length; i++)
        Container(
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(border: i == 0 ? null : const Border(top: BorderSide(color: C.line))),
          child: Wrap(spacing: 12, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
            Row(mainAxisSize: MainAxisSize.min, children: [
              Led(bays[i].green),
              const SizedBox(width: 12),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 220),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(bays[i].name, maxLines: 1, overflow: TextOverflow.ellipsis, style: T.body(15, weight: FontWeight.w500)),
                  Text(
                    '${bays[i].kw} kW · from ${formatEuro(bays[i].priceFromCents)}${from == null ? '' : ' · ${formatDistance(distanceM(from!, bays[i].point))}'}',
                    style: T.mono(13, em: 0, color: C.muted),
                  ),
                ]),
              ),
            ]),
            Row(mainAxisSize: MainAxisSize.min, children: [
              Btn('Book now', size: BtnSize.sm, onPressed: () => onBook(bays[i])),
              const SizedBox(width: 8),
              Btn('Go', size: BtnSize.sm, variant: BtnVariant.secondary, icon: LucideIcons.navigation, onPressed: () => openUrl(directionsUrl(bays[i].point))),
            ]),
          ]),
        ),
    ]);
  }
}

/// The booking's charges are its receipt: the fee, credit used, refunds, what came back, idle time
class Receipt extends StatelessWidget {
  const Receipt({super.key, required this.charges, required this.totalCents});
  final List<Charge> charges;
  final int totalCents;
  @override
  Widget build(BuildContext context) {
    Widget row(String k, String v, {Color color = C.ink, bool bold = false}) => Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(child: Text(k, style: T.body(15, color: color, weight: bold ? FontWeight.w600 : FontWeight.w400))),
            const SizedBox(width: 16),
            Text(v, style: T.mono(15, em: 0, color: color, weight: bold ? FontWeight.w600 : FontWeight.w400)),
          ]),
        );
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      for (final c in charges) row(c.label, formatEuro(c.cents), color: c.cents < 0 ? C.brandStrong : C.ink),
      Container(
        padding: const EdgeInsets.only(top: 8),
        decoration: const BoxDecoration(border: Border(top: BorderSide(color: C.line))),
        child: row('Total', formatEuro(totalCents), bold: true),
      ),
      const SizedBox(height: 4),
      Text('DEMO PAYMENT: NO CARD WAS CHARGED.', style: T.mono(12, color: C.muted)),
    ]);
  }
}

// ── brand drawings ──

/// The mark: a parking-bay outline holding a charge bolt, and the word mark. `light` is for dark surfaces.
class Logo extends StatelessWidget {
  const Logo({super.key, this.light = false});
  final bool light;
  @override
  Widget build(BuildContext context) => Semantics(
        label: 'Baywatch',
        excludeSemantics: true,
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          CustomPaint(size: const Size.square(32), painter: _MarkPainter(light)),
          const SizedBox(width: 10),
          Text.rich(
            TextSpan(children: [
              const TextSpan(text: 'Bay'),
              TextSpan(text: 'watch', style: TextStyle(color: light ? C.onBrandAccent : C.accent)),
            ]),
            style: T.display(26, color: light ? C.onBrand : C.ink, height: 1).copyWith(letterSpacing: 0.5),
          ),
        ]),
      );
}

class _MarkPainter extends CustomPainter {
  _MarkPainter(this.light);
  final bool light;
  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / 32);
    canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(0, 0, 32, 32), const Radius.circular(8)), Paint()..color = light ? C.signal : C.brand);
    canvas.drawPath(
      Path()
        ..moveTo(9, 8)
        ..lineTo(9, 24)
        ..lineTo(23, 24)
        ..lineTo(23, 8),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.2
        ..strokeCap = StrokeCap.round
        ..color = light ? C.ink.withValues(alpha: 0.8) : C.onBrand.withValues(alpha: 0.7),
    );
    canvas.drawPath(
      Path()
        ..moveTo(17.4, 10.5)
        ..lineTo(12.6, 17)
        ..lineTo(16.2, 17)
        ..lineTo(14.6, 22.5)
        ..lineTo(19.4, 15.9)
        ..lineTo(15.8, 15.9)
        ..close(),
      Paint()..color = light ? C.ink : C.signal,
    );
  }

  @override
  bool shouldRepaint(_MarkPainter old) => old.light != light;
}

enum Scene { find, guarded, arriving, charging, blocked }

/// Top-down drawing of the charging bay in one of its states (web/components/landing/bay-sketch.tsx)
class BaySketch extends StatefulWidget {
  const BaySketch(this.scene, {super.key, this.dark = false, this.width = 200});
  final Scene scene;
  final bool dark;
  final double width;
  @override
  State<BaySketch> createState() => _BaySketchState();
}

class _BaySketchState extends State<BaySketch> with SingleTickerProviderStateMixin {
  late final _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 2400));

  bool get _guard => widget.scene == Scene.guarded || widget.scene == Scene.arriving;

  @override
  void initState() {
    super.initState();
    if (_guard) _pulse.repeat();
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
        child: SizedBox(
          width: widget.width,
          height: widget.width * 0.8,
          child: CustomPaint(painter: _SketchPainter(widget.scene, widget.dark, _pulse)),
        ),
      );
}

class _SketchPainter extends CustomPainter {
  _SketchPainter(this.scene, this.dark, this.pulse) : super(repaint: pulse);
  final Scene scene;
  final bool dark;
  final Animation<double> pulse;

  Paint _stroke(Color c, double w) => Paint()
    ..style = PaintingStyle.stroke
    ..strokeWidth = w
    ..strokeCap = StrokeCap.round
    ..color = c;
  Paint _fill(Color c) => Paint()..color = c;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / 200);
    final white = Colors.white;
    // bay markings and the charger at its head
    canvas.drawPath(
      Path()
        ..moveTo(48, 150)
        ..lineTo(48, 26)
        ..lineTo(152, 26)
        ..lineTo(152, 150),
      _stroke(dark ? white.withValues(alpha: 0.4) : C.ink.withValues(alpha: 0.25), 3),
    );
    final pillar = RRect.fromRectAndRadius(const Rect.fromLTWH(88, 6, 24, 16), const Radius.circular(4));
    canvas.drawRRect(pillar, _fill(dark ? white.withValues(alpha: 0.15) : C.surface));
    canvas.drawRRect(pillar, _stroke(dark ? white.withValues(alpha: 0.4) : C.ink.withValues(alpha: 0.3), 1.5));
    canvas.drawPath(
      Path()
        ..moveTo(94, 14)
        ..lineTo(100, 14)
        ..lineTo(98, 18)
        ..lineTo(104, 18),
      _stroke(dark ? C.signal : C.brand, 1.5),
    );

    // the camera's field of view: violet, the brand's "technology" colour (orange-ish when it sees a stranger)
    if (scene == Scene.arriving || scene == Scene.blocked) {
      final cone = Path()
        ..moveTo(100, 20)
        ..lineTo(66, 96)
        ..lineTo(134, 96)
        ..close();
      final blocked = scene == Scene.blocked;
      final (fill, edge) = blocked
          ? (dark ? (C.signal.withValues(alpha: 0.1), C.signal.withValues(alpha: 0.6)) : (C.warn.withValues(alpha: 0.1), C.warn.withValues(alpha: 0.5)))
          : (dark ? (C.onBrandAccent.withValues(alpha: 0.15), C.onBrandAccent.withValues(alpha: 0.6)) : (C.accent.withValues(alpha: 0.1), C.accent.withValues(alpha: 0.5)));
      canvas.drawPath(cone, _fill(fill));
      canvas.drawPath(dashed(cone, 3, 3), _stroke(edge, 1));
    }

    if (scene == Scene.guarded || scene == Scene.arriving) {
      final t = pulse.value;
      final ringT = (t / 0.8).clamp(0.0, 1.0);
      canvas.drawCircle(const Offset(100, 78), 22 * (0.6 + 1.3 * ringT), _fill(C.signal.withValues(alpha: 0.3 * (1 - ringT))));
      final guard = RRect.fromRectAndRadius(const Rect.fromLTWH(80, 70, 40, 16), const Radius.circular(5));
      canvas.drawRRect(guard, _fill(C.signal));
      // lime vanishes on paper, so on light the guard gets an ink edge
      if (!dark) canvas.drawRRect(guard, _stroke(C.ink.withValues(alpha: 0.6), 1));
      canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(86, 76, 28, 4), const Radius.circular(2)), _fill(C.ink.withValues(alpha: 0.7)));
    }

    final carY = switch (scene) { Scene.arriving => 92.0, Scene.charging || Scene.blocked => 44.0, _ => null };
    if (carY != null) {
      final body = scene == Scene.blocked ? (dark ? white.withValues(alpha: 0.35) : C.faint) : C.brand;
      canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTWH(70, carY, 60, 96), const Radius.circular(16)), _fill(body));
      canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTWH(78, carY + 14, 44, 18), const Radius.circular(6)), _fill(white.withValues(alpha: 0.7)));
      canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTWH(80, carY + 64, 40, 12), const Radius.circular(5)), _fill(white.withValues(alpha: 0.35)));
    }

    if (scene == Scene.charging) {
      canvas.drawLine(const Offset(100, 22), const Offset(100, 44), _stroke(dark ? C.mint : C.brandStrong, 3));
    }

    if (scene == Scene.find) {
      final pin = Path()
        ..moveTo(100, 52)
        ..cubicTo(88, 52, 79, 61, 79, 73)
        ..cubicTo(79, 89, 100, 110, 100, 110)
        ..cubicTo(100, 110, 121, 89, 121, 73)
        ..cubicTo(121, 61, 112, 52, 100, 52)
        ..close();
      canvas.drawPath(pin, _fill(C.brand));
      canvas.drawCircle(const Offset(100, 73), 8, _fill(white));
    }

    if (scene == Scene.blocked) {
      canvas.drawCircle(const Offset(138, 30), 13, _fill(C.warn));
      canvas.drawLine(const Offset(138, 24), const Offset(138, 31), _stroke(white, 2.6));
      canvas.drawCircle(const Offset(138, 35.5), 1.6, _fill(white));
    }
  }

  @override
  bool shouldRepaint(_SketchPainter old) => old.scene != scene || old.dark != dark;
}
