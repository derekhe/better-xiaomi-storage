# Security Policy

## Reporting a vulnerability

Please use the repository's **Security** tab and private vulnerability reporting when available. Do not publish credentials, certificates, private keys, access tokens, device identifiers, logs, or personal photos in an issue.

If private reporting is unavailable, open a minimal issue asking the maintainer for a private contact channel. Do not include exploit details or sensitive data in that issue.

## Security boundary

Better Xiaomi Storage is a local, read-only gallery for Xiaomi Smart Storage. The 0.2.0-alpha.1 prerelease manages isolated native login/P2P components and obtains device certificates through the authenticated Xiaomi session. Account credentials and device private keys saved by this application are encrypted with Windows-backed Electron safeStorage and never exposed through renderer IPC. Native browser/SDK profiles remain under separate per-account directories; their internal storage and logging behavior has not yet been fully validated. The application does not import the official client's account profile, or provide upload, delete, or device-file mutation operations.

The native components use fixed loopback ports (25445 and 31288) and have no application-level socket authentication. This build refuses to start while those ports are already occupied; a malicious local process remains outside this isolation guarantee. Device HTTPS still verifies the CA and device certificate identity. Real account login, certificate issuance and device media access require manual validation before this development build is treated as a standalone release.

Only releases and checksums published under `https://github.com/derekhe/better-xiaomi-storage/releases` are official project artifacts. Version 0.1.0 is not code-signed, so verify the published SHA-256 checksum before installation.
