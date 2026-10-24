import 'dart:convert';

import 'package:http/http.dart' as http;

/// The Next.js app in web/ serves this API. Override with --dart-define=API_URL=...
const apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://localhost:3000');

double _d(Object? v) => (v as num).toDouble();

class Bay {
  Bay.fromJson(Map<String, dynamic> j) : name = j['name'] as String, lat = _d(j['lat']), lng = _d(j['lng']);
  final String name;
  final double lat, lng;
}

class Reservation {
  Reservation.fromJson(Map<String, dynamic> j)
      : id = j['id'] as String,
        status = j['status'] as String,
        plateHint = j['plateHint'] as String?,
        expiresAt = DateTime.fromMillisecondsSinceEpoch(j['expiresAt'] as int);
  final String id, status;
  final String? plateHint;
  final DateTime expiresAt;

  bool get active => const ['reserved', 'arrived', 'charging'].contains(status);
}

class LogEntry {
  LogEntry.fromJson(Map<String, dynamic> j)
      : at = DateTime.fromMillisecondsSinceEpoch(j['at'] as int),
        type = j['type'] as String,
        detail = j['detail'] as String;
  final DateTime at;
  final String type, detail;
}

class AppState {
  AppState.fromJson(Map<String, dynamic> j)
      : bay = Bay.fromJson(j['bay'] as Map<String, dynamic>),
        holdMinutes = j['holdMinutes'] as int,
        simulator = j['simulator'] as bool,
        hardwareState = (j['hardware'] as Map<String, dynamic>)['state'] as String,
        hardwareMock = (j['hardware'] as Map<String, dynamic>)['mock'] == true,
        reservation = j['reservation'] == null ? null : Reservation.fromJson(j['reservation'] as Map<String, dynamic>),
        log = [for (final l in j['log'] as List) LogEntry.fromJson(l as Map<String, dynamic>)];
  final Bay bay;
  final int holdMinutes;
  final bool simulator, hardwareMock;
  final String hardwareState;
  final Reservation? reservation;
  final List<LogEntry> log;
}

class Charger {
  Charger.fromJson(Map<String, dynamic> j)
      : id = j['id'] as int,
        name = j['name'] as String,
        lat = _d(j['lat']),
        lng = _d(j['lng']),
        address = j['address'] as String,
        fault = j['fault'] as bool,
        url = j['url'] as String?,
        points = [
          for (final p in j['points'] as List) '${p['count']}× ${p['type']} · ${p['power']} kW',
        ];
  final int id;
  final String name, address;
  final double lat, lng;
  final bool fault;
  final String? url;
  final List<String> points;
}

class ApiException implements Exception {
  ApiException(this.message);
  final String message;
  @override
  String toString() => message;
}

class Api {
  Api([http.Client? client]) : _client = client ?? http.Client();
  final http.Client _client;

  Future<Map<String, dynamic>> _send(String method, String path, [Map<String, Object?>? body, Map<String, String>? headers]) async {
    final uri = Uri.parse('$apiUrl$path');
    final res = method == 'GET'
        ? await _client.get(uri)
        : await _client.post(uri, headers: {'content-type': 'application/json', ...?headers}, body: jsonEncode(body ?? {}));
    final data = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    if (res.statusCode >= 400) throw ApiException(data['error'] as String? ?? 'HTTP ${res.statusCode}');
    return data;
  }

  Future<AppState> state() async => AppState.fromJson(await _send('GET', '/api/state'));

  Future<({List<Charger> chargers, String? warning, bool more})> chargers({
    required double south,
    required double west,
    required double north,
    required double east,
  }) async {
    final j = await _send('GET', '/api/chargers?sw_lat=$south&sw_lng=$west&ne_lat=$north&ne_lng=$east');
    return (
      chargers: [for (final c in j['chargers'] as List) Charger.fromJson(c as Map<String, dynamic>)],
      warning: j['warning'] as String?,
      more: j['more'] == true,
    );
  }

  /// The token proves this app made the reservation; it's needed for [step].
  Future<({String id, String token})> reserve(String plate) async {
    final j = await _send('POST', '/api/reservations', {'plate': plate});
    return (id: j['id'] as String, token: j['token'] as String);
  }

  /// action: cancel | charge | finish
  Future<void> step(String action, String? token) =>
      _send('POST', '/api/reservation/$action', null, {'x-reservation-token': token ?? ''});

  /// Dev only: fakes a camera plate event. Returns whether it matched the reservation.
  Future<bool> simulatePlate(String plate) async =>
      (await _send('POST', '/api/sim/plate-events', {'plate': plate}))['matched'] == true;
}
