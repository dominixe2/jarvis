# Loopback bridge validation

The bridge binding regression must be run on this branch before review:

- `node --test tests/bridge-binding.test.mjs`
- `npm test`, lint and build through the JARVIS validation workflow.
- Confirm the listener address is exactly `127.0.0.1`; do not test by exposing it on a LAN.

This change does not add phone pairing or remote access. The phone path remains a separate authenticated feature and must not reuse the unauthenticated local computer-control bridge.
