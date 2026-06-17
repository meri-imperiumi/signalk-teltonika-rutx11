# Changelog

## [0.6.2] - 2026-06-16
### Added
- Added icon for Signal K app store

## [0.6.1] - 2025-11-28
### Fixed
- Correct error message is now passed out on read errors

## [0.6.0] - 2024-01-07
### Changed
- Make it possible to enable/disable getting GPS position from the RUT
- GPS data is sent by some RUT devices as big endian, provide a config for that

## [0.5.0] - 2023-04-27
### Changed
- Improved error handling in case some parts of the ModBus communication fail
- We no longer try to get GPS position for RUT240 devices

## [0.4.0] - 2022-03-04
### Added
- Add support for using the Teltonika modem as a GPS source for Signal K

## [0.3.0] - 2022-02-04
### Added
- Add support for other Teltonika modems apart from X11
