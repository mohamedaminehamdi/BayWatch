import 'dart:convert';

import 'package:ecurious_reserve/api.dart';
import 'package:flutter_test/flutter_test.dart';

// Captured from the running web/ API. If the API's response shape changes, these break.
const reserved =
    '{"bay":{"name":"Ecurious test bay","lat":52.52,"lng":13.405},"holdMinutes":15,"simulator":true,"hardware":{"state":"blocked","mock":true},"reservation":{"id":"651ca1df-8ea2-4f16-9813-8fb5790eed56","status":"reserved","createdAt":1792798851789,"expiresAt":1792799751789,"plateHint":"MA•••34"},"log":[{"at":1792798851806,"type":"unknown_vehicle","detail":"plate does not match the reservation"},{"at":1792798851789,"type":"reserved","detail":"bay blocked for 15 min"}]}';
const ended =
    '{"bay":{"name":"Ecurious test bay","lat":52.52,"lng":13.405},"holdMinutes":15,"simulator":true,"hardware":{"state":"free","mock":true},"reservation":{"id":"651ca1df-8ea2-4f16-9813-8fb5790eed56","status":"completed","createdAt":1792798851789,"expiresAt":1792799751789,"arrivedAt":1792798851829,"endedAt":1792798851842,"plateHint":null},"log":[{"at":1792798851842,"type":"completed","detail":"bay is free"}]}';

void main() {
  test('parses an active reservation', () {
    final s = AppState.fromJson(jsonDecode(reserved) as Map<String, dynamic>);
    expect(s.bay.lat, 52.52);
    expect(s.hardwareState, 'blocked');
    expect(s.simulator, isTrue);
    expect(s.reservation!.id, '651ca1df-8ea2-4f16-9813-8fb5790eed56');
    expect(s.reservation!.status, 'reserved');
    expect(s.reservation!.active, isTrue);
    expect(s.reservation!.plateHint, 'MA•••34');
    expect(s.log.first.type, 'unknown_vehicle');
  });

  test('parses an ended reservation with the plate erased', () {
    final s = AppState.fromJson(jsonDecode(ended) as Map<String, dynamic>);
    expect(s.reservation!.active, isFalse);
    expect(s.reservation!.plateHint, isNull);
  });
}
