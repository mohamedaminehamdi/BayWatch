import 'package:flutter/material.dart';

import 'reserve_page.dart';

void main() => runApp(const App());

class App extends StatelessWidget {
  const App({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Ecurious Reserve',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(colorSchemeSeed: const Color(0xFF1F6E5A)),
        home: const ReservePage(),
      );
}
