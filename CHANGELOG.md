# Changelog

## [Unreleased]
### Fixed
- Adapt to the new Modbus register map in current RUTOS firmware: the
  modem status read no longer includes registers that were removed
- Read the GSM operator name from its new register. It was previously
  misread from the system hostname registers, and is now tolerated to
  be unavailable while the modem has no service
- GPS speed and accuracy are now decoded as 32 bit floats per the
  current register map
- Close the Modbus TCP connection after each read. Previously one
  connection was leaked per poll, eventually exhausting the modem's
  Modbus session limit
- Include the failing register read in error messages
- Optional register reads no longer abort the whole poll
- Stopping the plugin now also prevents an in-flight poll from
  scheduling further polls

### Added
- Add a smoketest (node:test) running the plugin against an in-process
  Modbus TCP mock, including the modem-out-of-service case
- Publish the router WAN IP address as `networking.wan.ip`, making it
  possible to tell whether the router is uplinked via WAN (for example
  Starlink) or mobile data
- Publish GPS accuracy as `navigation.gnss.horizontalDilution`

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
