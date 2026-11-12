# Muse2API dependency

Source: https://github.com/czg86389-hub/muse2api
Commit: b60f474977f125210eb7c71b0fc6668b2f1dd700
License: MIT, retained in LICENSE.

Only the Python runtime modules are included. No Muse AI Studio executable,
extracted bytecode, license mechanism, account data or browser profiles are included.

Local changes: generation is attempted once; stop events propagate to generation;
Chromium retains its sandbox, uses an explicitly bound loopback CDP port, does not
attach to a pre-existing browser, and is launched with a hidden Windows console.
The adapter in scripts/standalone_backend.py selects the exposed routes, replaces
the generation lifecycle, persists interruption as unknown, and adds the web's
proxy pool contract. The upstream update/push/admin HTML routes are not exposed.
