import 'dart:convert';
import 'dart:io';

import 'package:ecurious_reserve/api.dart';
import 'package:ecurious_reserve/app_state.dart';
import 'package:ecurious_reserve/screens/operator.dart';
import 'package:ecurious_reserve/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

// The fixture is GET /api/operator's shape made by the web's own engine (web/lib/schedule.ts, operator.ts) with a
// simulated week, a live booking, an open blocked-bay alert and a lock with hardware readings
void main() {
  test('parses the operator dashboard data', () {
    final j = jsonDecode(File('test/fixtures/operator.json').readAsStringSync()) as Map<String, dynamic>;
    final d = parseOperatorForTest(j);
    expect(d.bays, 2);
    expect(d.openAlerts, 1);
    expect(d.days, 7);
    expect(d.reservations, greaterThan(0));
    expect(d.logLines, greaterThan(0));
  });

  testWidgets('renders the dashboard: alerts, live bays, KPIs, chart and log', (tester) async {
    final fixture = File('test/fixtures/operator.json').readAsStringSync();
    api = Api(MockClient((req) async => http.Response(fixture, 200, headers: {'content-type': 'application/json'})));
    currentTab.value = AppTab.operator;
    tester.view.physicalSize = const Size(390 * 3, 844 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(theme: buildTheme(), home: const Scaffold(body: OperatorScreen())));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Operator dashboard'), findsOneWidget);
    expect(find.text('Blocked-bay alerts'), findsOneWidget);
    expect(find.textContaining('Bay is clear'.toUpperCase()), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox()); // stop the 3 s poll
  });
}
