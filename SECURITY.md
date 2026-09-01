# Security Policy

## Reporting a vulnerability

Please use the repository's **Security** tab and private vulnerability reporting when available. Do not publish credentials, certificates, private keys, access tokens, device identifiers, logs, or personal photos in an issue.

If private reporting is unavailable, open a minimal issue asking the maintainer for a private contact channel. Do not include exploit details or sensitive data in that issue.

## Security boundary

Better Xiaomi Storage is a local, read-only companion to the official Xiaomi Smart Storage Windows client. It reads the official client's locally generated certificate material only inside the Electron main process and talks to its authenticated loopback tunnel. It does not implement Xiaomi account login or provide upload, delete, or mutation operations.

Only releases and checksums published under `https://github.com/derekhe/better-xiaomi-storage/releases` are official project artifacts. Version 0.1.0 is not code-signed, so verify the published SHA-256 checksum before installation.
