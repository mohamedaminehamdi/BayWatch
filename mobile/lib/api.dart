import 'dart:convert';

import 'package:http/http.dart' as http;

import 'auth.dart';
import 'format.dart';

/// The Next.js app in web/ serves this API. Override with --dart-define=API_URL=... (an Android emulator reaches
/// the host's localhost at http://10.0.2.2:3000; a phone needs the computer's LAN address).
const apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://localhost:3000');

class ApiException implements Exception {
  ApiException(this.message, [this.status]);
  final String message;
  final int? status;
  @override
  String toString() => message;
}

// JSON helpers: numbers can arrive as int or double
int _i(Object? v) => (v as num).toInt();
int? _io(Object? v) => v == null ? null : (v as num).toInt();
double _d(Object? v) => (v as num).toDouble();
// optional text: GoingElectric sends `false` for a missing network, and the server passes it on
String? _so(Object? v) => v is String ? v : null;
List<T> _list<T>(Object? v, T Function(Map<String, dynamic>) f) => [for (final x in (v as List? ?? const [])) f(x as Map<String, dynamic>)];
Map<String, dynamic> _map(Object? v) => v as Map<String, dynamic>;

/// JSON calls to the app's own API, signed in with the driver's Clerk session token (Bearer). Throws the
/// server's error message on failure, as the web's components/api.ts does.
class Api {
  Api([http.Client? client]) : _client = client ?? http.Client();
  final http.Client _client;

  Future<dynamic> send(String method, String path, [Object? body]) async {
    final token = await session.token();
    final headers = {
      if (body != null) 'content-type': 'application/json',
      if (token != null) 'authorization': 'Bearer $token',
    };
    final req = http.Request(method, Uri.parse('$apiUrl$path'))..headers.addAll(headers);
    if (body != null) req.body = jsonEncode(body);
    final http.Response res;
    try {
      res = await http.Response.fromStream(await _client.send(req));
    } catch (_) {
      throw ApiException('The server isn’t reachable at $apiUrl.');
    }
    final Object? data;
    try {
      data = res.body.isEmpty ? null : jsonDecode(utf8.decode(res.bodyBytes));
    } catch (_) {
      throw ApiException('Request failed (${res.statusCode})', res.statusCode);
    }
    if (res.statusCode >= 400) {
      final msg = data is Map && data['error'] is String ? data['error'] as String : 'Request failed (${res.statusCode})';
      throw ApiException(msg, res.statusCode);
    }
    return data;
  }

  Future<dynamic> get(String path) => send('GET', path);
  Future<dynamic> post(String path, [Object? body]) => send('POST', path, body ?? const <String, Object?>{});
  Future<dynamic> delete(String path) => send('DELETE', path);

  // ── typed calls ──
  // GET /api/config: the server's public settings (its NEXT_PUBLIC_* values)
  Future<({String? clerkKey, VoiceConfig? voice})> config() async {
    final j = _map(await get('/api/config'));
    final v = j['vapi'] as Map<String, dynamic>?;
    return (
      clerkKey: j['clerkPublishableKey'] as String?,
      voice: v == null ? null : (publicKey: v['publicKey'] as String, assistantId: v['assistantId'] as String),
    );
  }
  Future<StateResponse> state() async => StateResponse.fromJson(_map(await get('/api/state')));
  Future<BaysResponse> bays({required double south, required double west, required double north, required double east, bool fast = false}) async =>
      BaysResponse.fromJson(_map(await get('/api/bays?sw_lat=$south&sw_lng=$west&ne_lat=$north&ne_lng=$east${fast ? '&min_power=50' : ''}')));
  Future<Bay> bay(String id) async => Bay.fromJson(_map(await get('/api/bays/${Uri.encodeComponent(id)}')));
  Future<Availability> availability(String bayId, String date) async =>
      Availability.fromJson(_map(await get('/api/bays/${Uri.encodeComponent(bayId)}/availability?date=$date')));
  Future<Quote> quote(String bayId, int start, int blocks) async =>
      Quote.fromJson(_map(await get('/api/bays/${Uri.encodeComponent(bayId)}/quote?start=$start&blocks=$blocks')));
  // "Book now": the server picks the slot, this moment from the block under way; the answer's start and end say what
  Future<Quote> quoteNow(String bayId) async => Quote.fromJson(_map(await get('/api/bays/${Uri.encodeComponent(bayId)}/quote?start=now')));
  Future<ReservationView> unlock(String bayId, Point at) async =>
      ReservationView.fromJson(_map(await post('/api/bays/${Uri.encodeComponent(bayId)}/unlock', {'lat': at.lat, 'lng': at.lng})));

  Future<List<Vehicle>> vehicles() async => _list(await get('/api/vehicles'), Vehicle.fromJson);
  Future<Vehicle> addVehicle({required String plate, required String label, required bool consent}) async =>
      Vehicle.fromJson(_map(await post('/api/vehicles', {'plate': plate, 'label': label, 'consent': consent})));
  Future<void> removeVehicle(String id) => delete('/api/vehicles/${Uri.encodeComponent(id)}');

  Future<BookingsResponse> bookings() async => BookingsResponse.fromJson(_map(await get('/api/bookings?v=2')));
  Future<ReservationView> reservation(String id) async => ReservationView.fromJson(_map(await get('/api/reservations/${Uri.encodeComponent(id)}')));
  // The demo payment, as the web sends it: the server decides how a booking is paid (lib/booking-api.ts)
  // `now`: "Book now", the server sets the slot (start and blocks are left out)
  Future<ReservationView> reserve({required String bayId, int? start, int? blocks, bool now = false, required String vehicleId, required int priceCents}) async =>
      ReservationView.fromJson(_map(await post('/api/reservations', {
        'bayId': bayId,
        if (now) 'now': true else ...{'start': start, 'blocks': blocks},
        'vehicleId': vehicleId,
        'priceCents': priceCents,
        'acceptFees': true,
        'payment': 'demo',
      })));
  /// action: cancel | checkin | charge | finish | plate
  Future<ReservationView> act(String id, String action, [Map<String, Object?>? body]) async =>
      ReservationView.fromJson(_map(await post('/api/reservations/${Uri.encodeComponent(id)}/$action', body)));
}

// replaceable in tests: Api(MockClient(...)) from package:http/testing.dart
Api api = Api();

typedef VoiceConfig = ({String publicKey, String assistantId});

// ── the contract (web/lib/booking-types.ts) ──

class ChargePoint {
  ChargePoint.fromJson(Map<String, dynamic> j) : type = j['type'] as String, power = _d(j['power']), count = _i(j['count']);
  final String type;
  final double power;
  final int count;
}

class Bay {
  Bay.fromJson(Map<String, dynamic> j)
      : id = j['id'] as String,
        name = j['name'] as String,
        lat = _d(j['lat']),
        lng = _d(j['lng']),
        address = _so(j['address']) ?? '',
        network = _so(j['network']),
        url = _so(j['url']),
        points = _list(j['points'], ChargePoint.fromJson),
        powerKw = _d(j['powerKw']),
        cls = j['class'] as String,
        real = j['real'] == true,
        guard = j['guard'] as String,
        status = j['status'] as String,
        led = j['led'] as String,
        nextBookingAt = _io(j['nextBookingAt']),
        priceFromCents = _i(j['priceFromCents']),
        today = j['today'] == null ? null : Availability.fromJson(_map(j['today']));
  final String id, name, address, cls, guard, status, led; // status: free | reserved | occupied | offline; led: green | red
  final String? network, url;
  final double lat, lng, powerKw;
  final List<ChargePoint> points;
  final bool real; // the three Baywatch bays
  final int? nextBookingAt;
  final int priceFromCents;
  final Availability? today; // GET /api/bays/{id} only

  Point get point => (lat: lat, lng: lng);
  bool get offline => status == 'offline';
  bool get green => led == 'green';
  String get kw => powerKw == powerKw.roundToDouble() ? powerKw.toInt().toString() : powerKw.toStringAsFixed(1);
}

class Block {
  Block(this.start, this.state);
  Block.fromJson(Map<String, dynamic> j) : start = _i(j['start']), state = j['state'] as String;
  final int start;
  final String state; // free | booked | gap | past | mine, and 'occupied' on the client (booking flow)
}

class Availability {
  Availability.fromJson(Map<String, dynamic> j)
      : bayId = j['bayId'] as String,
        date = j['date'] as String,
        blocks = _list(j['blocks'], Block.fromJson),
        maxBlocks = _i(j['maxBlocks']),
        cls = j['class'] as String;
  final String bayId, date, cls;
  final List<Block> blocks;
  final int maxBlocks;
}

class CancelStep {
  CancelStep.fromJson(Map<String, dynamic> j) : from = _i(j['from']), cents = _i(j['cents']), percent = _i(j['percent']);
  final int from, cents, percent;
}

class Quote {
  Quote.fromJson(Map<String, dynamic> j)
      : bayId = j['bayId'] as String,
        start = _i(j['start']),
        end = _i(j['end']),
        blocks = _i(j['blocks']),
        cls = j['class'] as String,
        cents = _i(j['cents']),
        demand = j['demand'] as String,
        multiplier = _d(j['multiplier']),
        creditAppliedCents = _i(j['creditAppliedCents'] ?? 0),
        payCents = _i(j['payCents'] ?? j['cents']),
        noShowCents = _i(j['noShowCents'] ?? j['cents']),
        cancelSchedule = _list(j['cancelSchedule'], CancelStep.fromJson),
        valid = j['valid'] == true,
        reason = j['reason'] as String?;
  final String bayId, cls, demand; // demand: Quiet | Normal | Busy | Peak
  final int start, end, blocks, cents, creditAppliedCents, payCents, noShowCents;
  final double multiplier;
  final List<CancelStep> cancelSchedule;
  final bool valid;
  final String? reason;

  String get multiplierText => multiplier == multiplier.roundToDouble() ? multiplier.toInt().toString() : '$multiplier';
}

class Charge {
  Charge.fromJson(Map<String, dynamic> j) : kind = j['kind'] as String, label = j['label'] as String, cents = _i(j['cents']), at = _i(j['at']);
  final String kind, label;
  final int cents, at;
}

class Reminder {
  Reminder.fromJson(Map<String, dynamic> j) : key = j['key'] as String, at = _i(j['at']);
  final String key; // day_before | live | five_before | five_left | slot_over | idle_fee
  final int at;
}

/// One booking, as its owner sees it. Never holds a full plate.
class ReservationView {
  ReservationView.fromJson(Map<String, dynamic> j)
      : id = j['id'] as String,
        bayId = j['bayId'] as String,
        bayName = j['bayName'] as String,
        real = j['real'] == true,
        guard = j['guard'] as String? ?? 'simulated',
        cls = j['class'] as String? ?? 'fast',
        start = _i(j['start']),
        end = _i(j['end']),
        blocks = _i(j['blocks'] ?? 0),
        status = j['status'] as String,
        arriveBy = _i(j['arriveBy']),
        feeCents = _i(j['feeCents'] ?? 0),
        demand = j['demand'] as String? ?? 'Normal',
        charges = _list(j['charges'], Charge.fromJson),
        totalCents = _i(j['totalCents'] ?? 0),
        creditUsedCents = _i(j['creditUsedCents'] ?? 0),
        creditGrantedCents = _i(j['creditGrantedCents'] ?? 0),
        cancelNowCents = _io(j['cancelNowCents']),
        cancelSchedule = _list(j['cancelSchedule'], CancelStep.fromJson),
        createdAt = _i(j['createdAt']),
        blockedSince = _io(j['blockedSince']),
        alternatives = j['reroute'] == null ? const [] : _list(_map(j['reroute'])['alternatives'], Bay.fromJson),
        carAtBay = j['carAtBay'] == true,
        plateHint = j['plateHint'] as String?,
        extraPlateHint = j['extraPlateHint'] as String?,
        vehicleLabel = j['vehicleLabel'] as String?,
        arrivedAt = _io(j['arrivedAt']),
        chargingAt = _io(j['chargingAt']),
        endedAt = _io(j['endedAt']),
        checkInMethod = j['checkInMethod'] as String?,
        matchedBy = j['matchedBy'] as String?,
        sentReminders = _list(j['sentReminders'], Reminder.fromJson),
        bookedVia = j['bookedVia'] as String?;

  final String id, bayId, bayName, guard, cls, status, demand;
  // status: upcoming | live | arrived | charging | walkup | completed | cancelled | no_show
  final bool real, carAtBay;
  final int start, end, blocks, arriveBy, feeCents, totalCents, creditUsedCents, creditGrantedCents, createdAt;
  final int? cancelNowCents, blockedSince, arrivedAt, chargingAt, endedAt;
  final List<Charge> charges;
  final List<CancelStep> cancelSchedule;
  final List<Bay> alternatives; // nearest free bays while this one is blocked
  final String? plateHint, extraPlateHint, vehicleLabel, checkInMethod, matchedBy, bookedVia;
  final List<Reminder> sentReminders;

  bool get ended => const {'completed', 'cancelled', 'no_show'}.contains(status);
}

class Vehicle {
  Vehicle.fromJson(Map<String, dynamic> j)
      : id = j['id'] as String,
        plate = j['plate'] as String,
        display = j['display'] as String,
        label = j['label'] as String,
        consentAt = _i(j['consentAt']);
  final String id, plate, display, label;
  final int consentAt;
}

class BaysResponse {
  BaysResponse.fromJson(Map<String, dynamic> j)
      : bays = _list(j['bays'], Bay.fromJson),
        realBays = _list(j['realBays'], Bay.fromJson),
        warning = j['warning'] as String?,
        more = j['more'] == true;
  BaysResponse.empty()
      : bays = const [],
        realBays = const [],
        warning = null,
        more = false;
  final List<Bay> bays; // GoingElectric chargers in the box, every one bookable
  final List<Bay> realBays; // the three Baywatch bays, always
  final String? warning;
  final bool more;
}

class ViewerSummary {
  ViewerSummary.fromJson(Map<String, dynamic> j)
      : creditCents = _i(j['creditCents'] ?? 0),
        firstFree = j['firstFree'] == true,
        active = j['active'] == null ? null : ReservationView.fromJson(_map(j['active'])),
        next = j['next'] == null ? null : ReservationView.fromJson(_map(j['next']));
  final int creditCents;
  final bool firstFree;
  final ReservationView? active; // arrived, charging or walk-up
  final ReservationView? next; // the soonest upcoming or live booking
}

/// GET /api/state: what the app shell needs on every screen (polled every 2 s)
class StateResponse {
  StateResponse.fromJson(Map<String, dynamic> j)
      : simulator = j['simulator'] == true,
        demand = j['demand'] as String?,
        viewer = j['viewer'] == null ? null : ViewerSummary.fromJson(_map(j['viewer'])),
        realBays = _list(j['realBays'], Bay.fromJson);
  final bool simulator;
  final String? demand; // the demo "Site demand" override: quiet | normal | busy | full
  final ViewerSummary? viewer;
  final List<Bay> realBays;
}

class BookingsResponse {
  BookingsResponse.fromJson(Map<String, dynamic> j)
      : upcoming = _list(j['upcoming'], ReservationView.fromJson),
        active = j['active'] == null ? null : ReservationView.fromJson(_map(j['active'])),
        past = _list(j['past'], ReservationView.fromJson),
        creditCents = _i(j['creditCents'] ?? 0),
        firstFree = j['firstFree'] == true;
  final List<ReservationView> upcoming, past;
  final ReservationView? active;
  final int creditCents;
  final bool firstFree;
}
