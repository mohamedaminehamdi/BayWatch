import 'dart:math' as math;

// Formatting, time and geo helpers, ported from web/components/time.ts, web/lib/pricing.ts and web/lib/geo.ts, plus
// the booking-rule constants the screens need (web/lib/booking-rules.ts). The server re-checks every rule; these
// only drive what the screens show. Times are epoch ms, money is integer euro cents.

const minute = 60000;
const hour = 60 * minute;
const day = 24 * hour;

const blockMs = 15 * minute; // the grid: starts on :00, :15, :30 and :45
const armMs = 10 * minute; // from start − 10 min the arm must be up, and a car in the bay blocks it
const minGapMs = 10 * minute; // free time between two sessions of a bay
const horizonMs = 60 * day; // the latest start
const currentBlockMs = 5 * minute; // the block under way can still be booked during its first 5 min
const arrivalGraceMs = 15 * minute;
const idleGraceMs = 5 * minute; // free minutes after the end
const idleCentsPerMin = 30;
const overstayCapCents = 1200;
const maxReservationCents = 1000; // €5 standard reservation, capped at €10 (docs/decisions.md D48)
const blockedCreditCents = 500;
const freeCancelMs = 2 * minute;

typedef BayClassInfo = ({String label, int maxBlocks, int percent});
const classes = <String, BayClassInfo>{
  'slow': (label: 'Slow (AC)', maxBlocks: 16, percent: 50),
  'fast': (label: 'Fast (DC)', maxBlocks: 8, percent: 100),
  'ultra': (label: 'Ultra-fast (DC)', maxBlocks: 4, percent: 150),
};
String classLabel(String cls) => classes[cls]?.label ?? cls;

int blockStart(int t) => t - ((t % blockMs) + blockMs) % blockMs;
int earliestStart(int now) => now - blockStart(now) < currentBlockMs ? blockStart(now) : blockStart(now) + blockMs;

// "Book now": this moment, from the block under way for at least an hour (the server sets the same slot)
({int start, int blocks}) nowSlot(String cls, int now) {
  final start = blockStart(now);
  return (start: start, blocks: math.min(((now + hour - start) / blockMs).ceil(), classes[cls]?.maxBlocks ?? 4));
}

// "Book now" from a later start books an hour, or the class maximum if that's shorter
int quickLength(String cls) => math.min(4, classes[cls]?.maxBlocks ?? 4);

// ── money ──
String _grouped(int n) => n.toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');
// €1.50, but €19 rather than €19.00 (en-IE, as on the web)
String formatEuro(int cents) {
  final a = cents.abs();
  final whole = _grouped(a ~/ 100);
  return '${cents < 0 ? '-' : ''}€$whole${a % 100 == 0 ? '' : '.${(a % 100).toString().padLeft(2, '0')}'}';
}

// ── time (the device's local time, 24-hour: drivers read "Held until 14:35", never "2:35 PM") ──
String _two(int n) => n.toString().padLeft(2, '0');
DateTime local(int ms) => DateTime.fromMillisecondsSinceEpoch(ms);
String formatTime(int ms) {
  final d = local(ms);
  return '${_two(d.hour)}:${_two(d.minute)}';
}

const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
String weekdayShort(int ms) => _weekdays[local(ms).weekday - 1];
// "Sat 24 Oct"
String formatDay(int ms) {
  final d = local(ms);
  return '${_weekdays[d.weekday - 1]} ${d.day} ${_months[d.month - 1]}';
}

bool sameDay(int a, int b) {
  final x = local(a), y = local(b);
  return x.year == y.year && x.month == y.month && x.day == y.day;
}

// 4:05 for a countdown
String formatCountdown(int ms) {
  final s = math.max(0, (ms / 1000).ceil());
  return '${s ~/ 60}:${_two(s % 60)}';
}

// "1 h 15 min": lengths read as durations, never as a time of day
String formatLength(int minutes) =>
    minutes < 60 ? '$minutes min' : '${minutes ~/ 60} h${minutes % 60 != 0 ? ' ${minutes % 60} min' : ''}';
String duration(int ms) => formatLength(math.max(1, (ms / minute).round()));

// ── the grid's days: YYYY-MM-DD in Europe/Berlin ──
// CET, or CEST from the last Sunday of March to the last Sunday of October (01:00 UTC both)
DateTime _lastSunday(int year, int month) {
  final last = DateTime.utc(year, month + 1, 0);
  return last.subtract(Duration(days: last.weekday % 7));
}

int berlinOffsetMs(int ms) {
  final t = DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true);
  final summer = !t.isBefore(_lastSunday(t.year, 3).add(const Duration(hours: 1))) && t.isBefore(_lastSunday(t.year, 10).add(const Duration(hours: 1)));
  return (summer ? 2 : 1) * hour;
}

String _iso(DateTime d) => '${d.year}-${_two(d.month)}-${_two(d.day)}';
String berlinDate(int ms) => _iso(DateTime.fromMillisecondsSinceEpoch(ms + berlinOffsetMs(ms), isUtc: true));
DateTime _parse(String date) => DateTime.utc(int.parse(date.substring(0, 4)), int.parse(date.substring(5, 7)), int.parse(date.substring(8, 10)), 12);
String addDays(String date, int n) => _iso(_parse(date).add(Duration(days: n)));
String dayLabel(String date) {
  final d = _parse(date);
  return '${_weekdays[d.weekday - 1]} ${d.day} ${_months[d.month - 1]}';
}

// ── geo ──
typedef Point = ({double lat, double lng});

double distanceM(Point a, Point b) {
  double rad(double d) => d * math.pi / 180;
  final h = math.pow(math.sin(rad(b.lat - a.lat) / 2), 2) + math.cos(rad(a.lat)) * math.cos(rad(b.lat)) * math.pow(math.sin(rad(b.lng - a.lng) / 2), 2);
  return 2 * 6371000 * math.asin(math.sqrt(h));
}

String formatDistance(double m) => m < 1000 ? '${math.max(10, (m / 10).round() * 10)} m' : '${(m / 1000).toStringAsFixed(1)} km';

// Driving directions in Google Maps; on phones dir_action=navigate starts turn-by-turn
Uri directionsUrl(Point p) => Uri.parse('https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=driving&dirflg=d&dir_action=navigate');
