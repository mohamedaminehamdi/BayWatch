import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:vapi/vapi.dart';

import 'api.dart';
import 'auth.dart';
import 'theme.dart';

enum _Phase { idle, starting, live }

/// Book by voice (docs/voice-booking.md, web/components/voice/mic-button.tsx). The signed-in driver's token from
/// /api/voice/session goes into the call's metadata, where the assistant can't see it, and the server's webhook
/// books for that driver. Hidden unless the server has a Vapi assistant (GET /api/config).
class MicButton extends StatefulWidget {
  const MicButton({super.key});
  @override
  State<MicButton> createState() => _MicButtonState();
}

class _MicButtonState extends State<MicButton> {
  var _phase = _Phase.idle;
  VapiClient? _client;
  VapiCall? _call;
  StreamSubscription<VapiEvent>? _events;

  @override
  void dispose() {
    _events?.cancel();
    _call?.stop(); // leaving the app ends the call
    _client?.dispose();
    super.dispose();
  }

  void _note(String text) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  Future<void> _start(VoiceConfig voice) async {
    setState(() => _phase = _Phase.starting);
    try {
      final token = (await api.post('/api/voice/session') as Map<String, dynamic>)['token'] as String;
      await VapiClient.platformInitialized.future; // web: the Vapi JS SDK has loaded
      final client = _client ??= VapiClient(voice.publicKey);
      final call = await client.start(assistantId: voice.assistantId, assistantOverrides: {
        'metadata': {'voiceToken': token},
      });
      _call = call;
      await _events?.cancel();
      _events = call.onEvent.listen((e) {
        if (!mounted) return;
        if (e.label == 'call-start') {
          setState(() => _phase = _Phase.live);
          _note('Listening. Say where, when and for how long you want to charge.');
        } else if (e.label == 'call-end') {
          setState(() => _phase = _Phase.idle);
          _note('Voice booking ended.');
        } else if (e.label == 'error') {
          setState(() => _phase = _Phase.idle);
          _note('The voice call dropped. Tap the mic to try again.');
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _phase = _Phase.idle);
      _note(e is ApiException ? e.message : 'Voice booking is unavailable');
    }
  }

  Future<void> _stop() async {
    await _call?.stop();
    if (mounted) setState(() => _phase = _Phase.idle);
  }

  @override
  Widget build(BuildContext context) {
    final voice = session.voice;
    if (voice == null) return const SizedBox.shrink();
    final live = _phase == _Phase.live;
    return Tooltip(
      message: live ? 'End voice booking' : 'Book by voice',
      child: Semantics(
        button: true,
        toggled: live,
        label: live ? 'End voice booking' : 'Book by voice',
        child: Material(
          color: live ? C.signal : C.surface,
          shape: CircleBorder(side: live ? BorderSide.none : const BorderSide(color: C.lineStrong)),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: _phase == _Phase.starting ? null : () => live ? _stop() : _start(voice),
            child: SizedBox.square(
              dimension: 44,
              child: Center(
                child: switch (_phase) {
                  _Phase.starting => const SizedBox.square(dimension: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                  _Phase.live => const Icon(LucideIcons.square, size: 16, color: C.ink),
                  _Phase.idle => const Icon(LucideIcons.mic, size: 20, color: C.ink),
                },
              ),
            ),
          ),
        ),
      ),
    );
  }
}
