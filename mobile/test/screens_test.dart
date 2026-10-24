import 'dart:convert';
import 'dart:io';

import 'package:ecurious_reserve/api.dart';
import 'package:ecurious_reserve/app_state.dart';
import 'package:ecurious_reserve/screens/booking.dart';
import 'package:ecurious_reserve/screens/booking_flow.dart';
import 'package:ecurious_reserve/screens/bookings.dart';
import 'package:ecurious_reserve/screens/landing.dart';
import 'package:ecurious_reserve/screens/vehicles.dart';
import 'package:ecurious_reserve/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

// Every screen and booking state, rendered at phone size against a mock API in the server's shapes
// (web/lib/booking-types.ts), so a layout overflow or a parse error fails here rather than on a phone.

const _min = 60000;
final _now = DateTime.now().millisecondsSinceEpoch;
final _block = _now - _now % (15 * _min);

Map<String, dynamic> _bay([Map<String, dynamic> over = const {}]) => {
      'id': 'bw-3',
      'name': 'Baywatch Bay 3',
      'lat': 52.52,
      'lng': 13.40509,
      'address': 'Hackathon venue',
      'points': [
        {'type': 'CCS', 'power': 200, 'count': 1},
      ],
      'powerKw': 200,
      'class': 'fast',
      'real': true,
      'guard': 'simulated',
      'status': 'free',
      'led': 'green',
      'priceFromCents': 400,
      ...over,
    };

Map<String, dynamic> _booking(Map<String, dynamic> over) {
  final start = (over['start'] as int?) ?? _block + 15 * _min;
  return {
    'id': 'r1',
    'bayId': 'bw-3',
    'bayName': 'Baywatch Bay 3',
    'real': true,
    'guard': 'simulated',
    'class': 'fast',
    'start': start,
    'end': start + 60 * _min,
    'blocks': 4,
    'status': 'live',
    'arriveBy': start + 15 * _min,
    'feeCents': 500,
    'demand': 'Normal',
    'charges': [
      {'kind': 'reservation', 'label': 'Reservation · Fast (DC) · normal demand', 'cents': 500, 'at': _now},
      {'kind': 'credit', 'label': 'Free first reservation', 'cents': -500, 'at': _now},
    ],
    'totalCents': 0,
    'creditUsedCents': 500,
    'creditGrantedCents': 0,
    'cancelNowCents': 0,
    'cancelSchedule': [
      {'from': _now, 'cents': 0, 'percent': 0},
      {'from': _now + 2 * _min, 'cents': 250, 'percent': 50},
      {'from': start - 5 * _min, 'cents': 400, 'percent': 80},
    ],
    'createdAt': _now - _min,
    'carAtBay': false,
    'plateHint': 'B•••26',
    'vehicleLabel': 'Test Zoe',
    'sentReminders': [],
    ...over,
  };
}

final _vehicle = {'id': 'v1', 'plate': 'BBW2026', 'display': 'B BW 2026', 'label': 'Test Zoe', 'consentAt': _now};

Map<String, dynamic> _availability() => {
      'bayId': 'bw-3',
      'date': '2026-10-24',
      'blocks': [
        for (var i = 0; i < 96; i++)
          {
            'start': _block - 4 * 60 * _min + i * 15 * _min,
            'state': i < 17 ? 'past' : (i == 30 || i == 31 ? 'booked' : (i == 32 ? 'gap' : 'free')),
          },
      ],
      'maxBlocks': 8,
      'class': 'fast',
    };

Map<String, dynamic> _quote() => {
      'bayId': 'bw-3',
      'start': _block,
      'end': _block + 60 * _min,
      'blocks': 4,
      'class': 'fast',
      'cents': 500,
      'demand': 'Normal',
      'multiplier': 1,
      'creditAppliedCents': 500,
      'payCents': 0,
      'noShowCents': 500,
      'cancelSchedule': [
        {'from': _now, 'cents': 0, 'percent': 0},
        {'from': _now + 2 * _min, 'cents': 250, 'percent': 50},
      ],
      'valid': true,
    };

/// The API, answering by path; `reservation` is what GET /api/reservations/{id} returns
void _mockApi({Map<String, dynamic>? reservation}) {
  final b = _booking({});
  api = Api(MockClient((req) async {
    final p = req.url.path;
    final Object body = switch (p) {
      '/api/state' => {'simulator': true, 'demand': null, 'viewer': {'creditCents': 0, 'firstFree': true, 'active': null, 'next': b}, 'realBays': [_bay()]},
      '/api/vehicles' => [_vehicle],
      '/api/bookings' => {'upcoming': [b], 'active': _booking({'id': 'r2', 'status': 'charging', 'chargingAt': _now - 10 * _min}), 'past': [_booking({'id': 'r3', 'status': 'completed'})], 'creditCents': 500, 'firstFree': false},
      '/api/bays' => {'bays': [_bay({'id': 'ge-1', 'real': false, 'name': 'Mollstraße', 'network': false})], 'realBays': [_bay()]},
      final s when s.startsWith('/api/reservations/') => reservation ?? b,
      final s when s.endsWith('/availability') => _availability(),
      final s when s.endsWith('/quote') => _quote(),
      final s when s.startsWith('/api/bays/') => _bay(),
      _ => {'error': 'Not found'},
    };
    return http.Response(jsonEncode(body), body is Map && body.containsKey('error') ? 404 : 200, headers: {'content-type': 'application/json'});
  }));
}

Future<void> _phone(WidgetTester tester, Widget home) async {
  tester.view.physicalSize = const Size(390 * 3, 844 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(theme: buildTheme(), home: home));
  await tester.pump(const Duration(milliseconds: 100));
  await tester.pump(const Duration(milliseconds: 100));
}

// Scrolls the whole screen into view, so every part of it gets laid out
Future<void> _scrollAll(WidgetTester tester) async {
  final scrollables = find.byType(Scrollable);
  for (var i = 0; i < 8 && scrollables.evaluate().isNotEmpty; i++) {
    await tester.drag(scrollables.first, const Offset(0, -500), warnIfMissed: false);
    await tester.pump(const Duration(milliseconds: 50));
  }
}

// The real brand fonts, so text is as wide as on a phone (the test font's square glyphs are wider)
Future<void> _loadFonts() async {
  for (final (family, files) in [
    ('Bebas Neue', ['BebasNeue-400']),
    ('Space Grotesk', ['SpaceGrotesk-400', 'SpaceGrotesk-500', 'SpaceGrotesk-600', 'SpaceGrotesk-700']),
    ('JetBrains Mono', ['JetBrainsMono-400', 'JetBrainsMono-500', 'JetBrainsMono-600', 'JetBrainsMono-700']),
  ]) {
    final loader = FontLoader(family);
    for (final f in files) {
      loader.addFont(Future.value(ByteData.sublistView(File('assets/fonts/$f.ttf').readAsBytesSync())));
    }
    await loader.load();
  }
}

void main() {
  setUpAll(_loadFonts);
  final states = <String, Map<String, dynamic>>{
    'upcoming': {'status': 'upcoming', 'start': _block + 3 * 60 * _min},
    'live, before the start': {'status': 'live'},
    'live, the camera saw a car': {'status': 'live', 'start': _block, 'carAtBay': true, 'sentReminders': [{'key': 'live', 'at': _now}]},
    'blocked, with alternatives and a credit': {
      'status': 'live',
      'blockedSince': _now - 5 * _min,
      'creditGrantedCents': 500,
      'reroute': {'alternatives': [_bay({'id': 'ge-1', 'real': false, 'name': 'Mollstraße 4 with a long name'})]},
    },
    'arrived': {'status': 'arrived', 'start': _block, 'arrivedAt': _now, 'checkInMethod': 'camera', 'matchedBy': 'fuzzy', 'cancelNowCents': null},
    'charging, slot over': {'status': 'charging', 'start': _block - 60 * _min, 'chargingAt': _block - 55 * _min, 'cancelNowCents': null, 'sentReminders': [{'key': 'idle_fee', 'at': _now}]},
    'walk-up': {'status': 'walkup', 'start': _block, 'checkInMethod': 'walkup', 'cancelNowCents': null},
    'completed with an idle fee': {
      'status': 'completed',
      'arrivedAt': _now - 50 * _min,
      'chargingAt': _now - 49 * _min,
      'endedAt': _now,
      'cancelNowCents': null,
      'charges': [
        {'kind': 'reservation', 'label': 'Reservation · Fast (DC) · normal demand', 'cents': 500, 'at': _now},
        {'kind': 'overstay', 'label': 'Idle fee: 3 min after the 5 free minutes', 'cents': 90, 'at': _now},
      ],
      'totalCents': 590,
    },
    'cancelled': {'status': 'cancelled', 'cancelNowCents': null, 'totalCents': 250},
    'no-show': {'status': 'no_show', 'cancelNowCents': null, 'totalCents': 500},
  };

  for (final MapEntry(key: name, value: over) in states.entries) {
    testWidgets('booking screen: $name', (tester) async {
      _mockApi(reservation: _booking(over));
      await _phone(tester, const BookingScreen(id: 'r1'));
      expect(find.text('Baywatch Bay 3'.toUpperCase()), findsNothing); // Bebas sets capitals in the font, not the text
      expect(find.text('Baywatch Bay 3'), findsWidgets);
      await _scrollAll(tester);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox()); // stop the polls
    });
  }

  testWidgets('bookings: credit, active, upcoming and past', (tester) async {
    _mockApi();
    currentTab.value = AppTab.bookings;
    await _phone(tester, const Scaffold(body: BookingsScreen()));
    expect(find.text('Bookings'), findsOneWidget);
    await _scrollAll(tester);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('cars and welcome', (tester) async {
    _mockApi();
    currentTab.value = AppTab.vehicles;
    await _phone(tester, const Scaffold(body: VehiclesScreen()));
    expect(find.text('Your cars'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await _phone(tester, const WelcomeScreen());
    await _scrollAll(tester);
    expect(tester.takeException(), isNull);
  });

  testWidgets('landing, scrolled to the end', (tester) async {
    _mockApi();
    await _phone(tester, const LandingScreen());
    await _scrollAll(tester);
    await _scrollAll(tester);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('booking flow: Book now, then Choose a time', (tester) async {
    _mockApi();
    await _phone(tester, Scaffold(body: Builder(builder: (context) => Center(child: TextButton(onPressed: () => showBookingFlow(context, Bay.fromJson(_bay())), child: const Text('open'))))));
    await tester.tap(find.text('open'));
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.textContaining('Starts now'.toUpperCase()), findsOneWidget);
    await tester.tap(find.text('Choose a time'));
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pump(const Duration(milliseconds: 500));
    await _scrollAll(tester);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
}
