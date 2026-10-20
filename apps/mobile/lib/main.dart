import 'package:flutter/material.dart';

void main() {
  runApp(const PatronApp());
}

class PatronApp extends StatelessWidget {
  const PatronApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Patron',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo),
        useMaterial3: true,
      ),
      home: const HomePage(),
    );
  }
}

class HomePage extends StatelessWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Patron')),
      body: const Center(
        // Scaffold only — features are added per module, nothing here yet.
        child: Text('Patron mobile scaffold'),
      ),
    );
  }
}
