# @patron/mobile

Flutter mobile application for the Patron platform.

This is a scaffold — application code lives in `lib/` and nothing
business-specific is implemented yet.

## Prerequisites

- [Flutter SDK](https://docs.flutter.dev/get-started/install) `>= 3.5`

## Generating platform folders

The `android/`, `ios/`, `web/`, and other platform directories are **not**
committed. Generate them from this directory the first time you clone:

```bash
cd apps/mobile
flutter create .
```

`flutter create .` reads the existing `pubspec.yaml` and `lib/` and only
adds the missing platform scaffolding.

## Common commands

```bash
flutter pub get     # install dependencies
flutter analyze     # static analysis / lints
flutter test        # run widget tests
flutter run         # launch on a connected device/emulator
```

> The mobile app is built with the Flutter toolchain and is intentionally
> outside the Turborepo/npm task graph.
