# Security Policy

## Reporting a vulnerability

Please use the repository's **Security** tab and private vulnerability reporting when available. Do not publish credentials, certificates, private keys, access tokens, device identifiers, logs, or personal photos in an issue.

If private reporting is unavailable, open a minimal issue asking the maintainer for a private contact channel. Do not include exploit details or sensitive data in that issue.

## Security boundary

Better Xiaomi Storage is a local gallery for Xiaomi Smart Storage with integrated login and photo cleanup. The 0.2.0-alpha.1 prerelease manages isolated native login/P2P components and obtains device certificates through the authenticated Xiaomi session. Account credentials and device private keys saved by this application are encrypted with Windows-backed Electron safeStorage and never exposed through renderer IPC. Native browser/SDK profiles remain under separate per-account directories; their internal storage and logging behavior has not yet been fully validated. The application does not import the official client's account profile or provide uploads or permanent deletion.

The native components use fixed loopback ports (25445 and 31288). Commands include a random key shared with the native child through its environment; this key is rotated per process and is neither persisted nor exposed to renderer IPC. The callback listener remains a local trust boundary. This build refuses to start while those ports are already occupied; a malicious local process remains outside this isolation guarantee. Device HTTPS verifies the CA and device certificate identity. Real device connection and album reads have been exercised locally; complete installer and account lifecycle validation remain separate checks.

Photo cleanup analyzes device previews locally. The sole mutation operation moves explicitly selected photos into the device recycle bin using `album/del_photo` with `notrash: 0`. The main process validates 1–500 photo paths against a fresh complete index and favorites, requires a native confirmation dialog with Cancel selected by default, and rechecks index/favorites after confirmation. Unknown files, videos, and favorites are rejected. Mutations are never automatically retried or changed to permanent deletion. Unconfirmed per-file outcomes are reported as failures; users should refresh before retrying. Concurrent cleanup requests are rejected. Device-side changes made by another client between the final check and mutation remain possible.

Background analysis uses a separate hidden renderer and Web Worker; optional LIQE inference runs in a dedicated local Python process. Its restricted preload has no account or deletion methods. Analysis IPC checks the account/device scope, device switching and logout pause the task first, and deletion is refused while analysis runs. Preview images are only held in memory; compact features and versioned AI scores are encrypted with safeStorage in account/device-specific checkpoint files. Model checkpoints are pinned by SHA-256 and deserialized with tensor-only loading. Runtime preparation downloads public model assets, while inference performs no network requests to third-party services.

Cleanup requests include the analyzed photo ID, modification time and file size, checked against fresh device indexes. The active device is checked around asynchronous reads and immediately before mutation; login, device switching, logout and reconnection are blocked during cleanup. Renderer cleanup results are reset when connecting another device.

Only releases and checksums published under `https://github.com/derekhe/better-xiaomi-storage/releases` are official project artifacts. Version 0.1.0 is not code-signed, so verify the published SHA-256 checksum before installation.
