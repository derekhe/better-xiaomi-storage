# Third-party notices

The photo cleanup algorithms in `src/lib/cleanup-metrics.ts` and `src/lib/cleanup.ts`
are derived from [qingle-album](https://github.com/vickysy/qingle-album),
commit `649a9f0cbbf100622324976aee9bc551c5a8dfce`:

- `app/src/main/java/com/dtu/cleaner/core/ImageMetrics.kt`
- `app/src/main/java/com/dtu/cleaner/core/Grouping.kt`

Copyright 2026 木妈AIdea.
Licensed under the Apache License, Version 2.0. See `licenses/qingle-album-Apache-2.0.txt`.

Changes: translated from Kotlin to TypeScript, adapted pixel input to RGBA and
browser workers, omitted face and NIMA scoring, used preview dimensions and file
size for ranking, added conservative selection for loose similarity and screenshots,
bounded thumbnail reads, stale-result checks, and integrated Xiaomi recycle-bin operations.
No Android, ML Kit, LiteRT or NIMA binaries are included.

Upstream NOTICE identifies the project as “D图 · AI 相册清理”, copyright 2026 木妈AIdea.
The original NOTICE is included at `licenses/qingle-album-NOTICE.txt`.

Other original project code remains under this repository's MIT license.

## LIQE and CLIP

`electron/liqe_worker.py` adapts the inference algorithm from
[LIQE](https://github.com/zwx8981/LIQE), Copyright (c) 2024 Weixia Zhang,
under the MIT license (`licenses/LIQE-MIT.txt`). Changes include deterministic
spatial crop selection, bounded image preprocessing, local-only model loading,
tensor-only checkpoint deserialization and a streaming background-process protocol.
The original author's public checkpoint is pinned by SHA-256 in `electron/liqe.cjs`.

The optional local runtime includes [OpenAI CLIP](https://github.com/openai/CLIP),
commit `a1d071733d7111c9c014f024669f959182114e33`, under the MIT license
(`licenses/CLIP-MIT.txt`). PyTorch, torchvision, Python and their dependencies
retain their own license notices in the prepared runtime. IQA-PyTorch is not included.
