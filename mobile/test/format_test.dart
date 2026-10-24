import 'dart:convert';

import 'package:ecurious_reserve/api.dart';
import 'package:ecurious_reserve/format.dart';
import 'package:flutter_test/flutter_test.dart';

int utc(int y, int mo, int d, int h, int mi) => DateTime.utc(y, mo, d, h, mi).millisecondsSinceEpoch;

void main() {
  test('formats money as the web does (en-IE)', () {
    expect(formatEuro(150), '€1.50');
    expect(formatEuro(1900), '€19');
    expect(formatEuro(-50), '-€0.50');
    expect(formatEuro(123456), '€1,234.56');
  });

  test('dates are Berlin dates, across both daylight-saving changes', () {
    expect(berlinDate(utc(2026, 10, 24, 21, 59)), '2026-10-24'); // 23:59 CEST
    expect(berlinDate(utc(2026, 10, 24, 22, 0)), '2026-10-25'); // 00:00 CEST
    expect(berlinDate(utc(2026, 10, 25, 22, 59)), '2026-10-25'); // 23:59 CET, after the change
    expect(berlinDate(utc(2026, 10, 25, 23, 0)), '2026-10-26');
    expect(berlinDate(utc(2026, 3, 28, 22, 59)), '2026-03-28'); // 23:59 CET
    expect(berlinDate(utc(2026, 3, 29, 22, 0)), '2026-03-30'); // 00:00 CEST
    expect(addDays('2026-10-24', 1), '2026-10-25');
    expect(addDays('2026-12-31', 1), '2027-01-01');
    expect(dayLabel('2026-10-24'), 'Sat 24 Oct');
  });

  test('the grid: the block under way is bookable for its first 5 minutes', () {
    final block = utc(2026, 10, 24, 14, 0);
    expect(earliestStart(block + 4 * minute), block);
    expect(earliestStart(block + 5 * minute), block + blockMs);
    expect(formatLength(75), '1 h 15 min');
    expect(formatLength(45), '45 min');
    expect(formatCountdown(61000), '1:01');
  });

  test('parses a booking as the server sends it (GET /api/reservations/{id})', () {
    const json =
        '{"id":"r1","bayId":"bw-3","bayName":"Baywatch Bay 3","real":true,"guard":"simulated","class":"fast","start":1792850400000,"end":1792854000000,"blocks":4,"status":"live","arriveBy":1792851300000,"feeCents":500,"demand":"Normal","charges":[{"kind":"reservation","label":"Reservation · Fast (DC) · normal demand","cents":500,"at":1792846800000},{"kind":"credit","label":"Free first reservation","cents":-500,"at":1792846800000}],"totalCents":0,"creditUsedCents":500,"creditGrantedCents":0,"cancelNowCents":0,"cancelSchedule":[{"from":1792846800000,"cents":0,"percent":0}],"createdAt":1792846800000,"carAtBay":false,"plateHint":"MA•••34","sentReminders":[{"key":"live","at":1792848600000}]}';
    final r = ReservationView.fromJson(jsonDecode(json) as Map<String, dynamic>);
    expect(r.status, 'live');
    expect(r.ended, isFalse);
    expect(r.charges.last.cents, -500);
    expect(r.cancelNowCents, 0);
    expect(r.alternatives, isEmpty);
    expect(r.sentReminders.single.key, 'live');
    expect(r.blockedSince, isNull);
  });

  test('parses a GoingElectric bay without a network (sent as false)', () {
    const json =
        '{"id":"ge-3080","name":"Parkhaus Radisson Blu","lat":52.51918,"lng":13.402989,"address":"Karl-Liebknecht-Straße 3, 10178, Berlin","network":false,"points":[{"type":"Schuko","power":2.3,"count":2}],"powerKw":11,"class":"slow","real":false,"guard":"simulated","status":"free","led":"green","priceFromCents":200}';
    final b = Bay.fromJson(jsonDecode(json) as Map<String, dynamic>);
    expect(b.network, isNull);
    expect(b.points.single.power, 2.3);
    expect(b.kw, '11');
  });
}
