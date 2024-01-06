Teltonika RUT modem plugin for Signal K
=======================================

This plugin makes status information from your Teltonika RUT (for example [RUTX11](https://teltonika-networks.com/product/rutx11/)) boat router available to Signal K.

The data model is roughly equivalent to [signalk-netgear-lte-status](https://www.npmjs.com/package/signalk-netgear-lte-status).

## Supported modems:

* RUT240, RUT360, RUT950, RUT955, RUTX9, RUTX11 and RUTX14 

## Usage

* Install this plugin to Signal K
* [Enable Modbus](https://wiki.teltonika-networks.com/view/RUTX11_Monitoring_via_Modbus) in your RUTX11
* Enable the plugin and set the Modbus connection details you configured for the router

## Changes

* 0.5.1 (January XX 2024)
  - GPS data is send by some RUTX as big endian, provide a config for that
    (https://github.com/meri-imperiumi/signalk-teltonika-rutx11/issues/90)
* 0.5.0 (April 27th 2023)
  - Improved error handling in case some parts of the ModBus communication fail
  - We no longer try to get GPS position for RUT240 devices
* 0.4.0 (March 4th 2022)
  - Add support for using the Teltonika modem as a GPS source for Signal K
* 0.3.0 (February 4th 2022)
  - Add support for other Teltonika modems apart from X11
