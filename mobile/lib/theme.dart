import 'package:flutter/material.dart';

// The Ecurious brand tokens, the same names and values as web/app/globals.css (web/DESIGN.md §2): paper and ink
// neutrals, voltage lime as a fill (never text on paper), ultraviolet for text and lines on light.
abstract final class C {
  static const page = Color(0xFFF5F4F1); // paper
  static const surface = Color(0xFFFFFFFF);
  static const sunken = Color(0xFFECEAE3); // paper-2
  static const line = Color(0xFFD9D9D7); // decorative only
  static const lineStrong = Color(0xFF858687); // input edges: 3:1 on every light surface
  static const ink = Color(0xFF0F1419);
  static const muted = Color(0xFF55595E);
  static const faint = Color(0xFF6C6F73);

  static const brand = ink; // primary actions are ink pills
  static const brandStrong = Color(0xFF1F2933); // hover, raised dark card, text on lime tints
  static const brandDeep = ink; // dark bands and the live-booking card
  static const brandTint = Color(0xFFE7F2A8); // held-for-you chips, selected rows
  static const brandSoft = Color(0xFFDCEB8C);
  static const onBrand = Color(0xFFF5F4F1);
  static const onBrandMuted = Color(0xFF9E9F9F);
  static const mint = Color(0xFFC8E847); // lime marks on dark

  static const signal = Color(0xFFC8E847); // voltage lime: a fill with ink on it, or a mark on ink
  static const signalStrong = Color(0xFFD4F05A);

  static const accent = Color(0xFF5A1DF0); // ultraviolet
  static const accentTint = Color(0xFFEAE2FF);
  static const onBrandAccent = Color(0xFFB69BFF);

  static const warn = Color(0xFFA8430F);
  static const warnTint = Color(0xFFFDEBDF);
  static const danger = Color(0xFFB3261E);
  static const dangerTint = Color(0xFFFCE8E6);

  static const context = Color(0xFF84888C); // public chargers on the map
  static const location = Color(0xFF2563EB); // your location
  static const plateBlue = Color(0xFF1D4FA0); // the EU plate band: real-world colours, not brand
  static const plateStar = Color(0xFFFFCC00);
}

// Bebas Neue capitals for headlines and big numbers, Space Grotesk for reading, JetBrains Mono for labels,
// buttons, prices and data. `em` letter-spacing is converted to logical pixels, as CSS does.
abstract final class T {
  static TextStyle display(double size, {Color? color, double height = 0.95}) =>
      TextStyle(fontFamily: 'Bebas Neue', fontSize: size, height: height, letterSpacing: size * 0.012, color: color);

  static TextStyle mono(double size, {FontWeight weight = FontWeight.w500, double em = 0.08, Color? color}) =>
      TextStyle(fontFamily: 'JetBrains Mono', fontSize: size, fontWeight: weight, letterSpacing: size * em, color: color, height: 1.3);

  static TextStyle body(double size, {FontWeight weight = FontWeight.w400, Color? color, double height = 1.45}) =>
      TextStyle(fontFamily: 'Space Grotesk', fontSize: size, fontWeight: weight, color: color, height: height);

  // the data labels: mono capitals, muted (LEFT TO ARRIVE, HELD UNTIL)
  static TextStyle label({Color color = C.muted, double size = 12}) => mono(size, color: color, em: 0.1);
}

ThemeData buildTheme() {
  final base = ThemeData(
    useMaterial3: true,
    fontFamily: 'Space Grotesk',
    scaffoldBackgroundColor: C.page,
    colorScheme: const ColorScheme.light(
      primary: C.ink,
      onPrimary: C.onBrand,
      secondary: C.accent,
      onSecondary: C.surface,
      surface: C.surface,
      onSurface: C.ink,
      error: C.danger,
      outline: C.lineStrong,
    ),
    splashFactory: InkSparkle.splashFactory,
  );
  return base.copyWith(
    textTheme: base.textTheme.apply(bodyColor: C.ink, displayColor: C.ink, fontFamily: 'Space Grotesk'),
    dividerColor: C.line,
    textSelectionTheme: const TextSelectionThemeData(cursorColor: C.accent, selectionColor: C.signal, selectionHandleColor: C.accent),
    checkboxTheme: CheckboxThemeData(
      fillColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? C.ink : C.surface),
      side: const BorderSide(color: C.lineStrong, width: 1.5),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
    ),
    switchTheme: SwitchThemeData(
      trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? C.ink : C.sunken),
      thumbColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? C.signal : C.surface),
      trackOutlineColor: const WidgetStatePropertyAll(C.lineStrong),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: C.surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
      hintStyle: T.body(16, color: C.faint),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(999), borderSide: const BorderSide(color: C.lineStrong)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(999), borderSide: const BorderSide(color: C.lineStrong)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(999), borderSide: const BorderSide(color: C.accent, width: 2)),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: C.ink,
      contentTextStyle: T.body(14, color: C.onBrand),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: C.ink),
  );
}
