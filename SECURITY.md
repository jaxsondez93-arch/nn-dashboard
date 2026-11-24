# Security notes

**Status: experimental and unaudited.** The login code was written for a hobby project, has had no independent security review, and has no TLS of its own. Do not rely on it to protect anything important.

## Intended use
Run the dashboard bound to `127.0.0.1` (the default) and reach it from your own devices through a private network (Tailscale, WireGuard, an SSH tunnel). Do not expose it directly to the internet. Over plain HTTP, a session token can be read by anyone on the path.

## What the login does
- A 32-byte master key is created on first run (file mode 0600 in a 0700 directory) from the operating system's random source (Python's `secrets`). The server refuses to start if the file has the wrong permissions, length, or is all zeros.
- A phone pairs with a single-use, 5-minute, 128-bit token (stored only as a hash) and receives its own device key, derived from the master key, shown once.
- Each login is a challenge-response: the server sends a fresh random value, the phone answers with an HMAC of it. Values are single-use, comparisons are constant-time, failures are rate-limited per client address, and sessions last an hour and live only in memory.
- Deleting a device from `devices.json` revokes it.
- The endpoints are read-only: nothing a phone sends can start, stop or modify the training.

## Known gaps
- No TLS; no protection against someone who can read the network path.
- Rate limiting is per client address, so behind a proxy all clients look like one address.
- The master key sits unencrypted on disk (protected only by file permissions); anyone who can read it can mint devices.
- A one-time pad and true hardware randomness were considered and rejected for this use; the operating system's random source is the deliberate choice.
- The code has been tested only against itself (see `tests/`).

## Reporting a problem
Please use GitHub's private vulnerability reporting for this repository if it is enabled, or open an issue describing the class of problem without a working exploit.
