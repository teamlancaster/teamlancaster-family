# R2 layout (bucket `teamlancaster-photos`, PRIVATE)

No public bucket access, no r2.dev URL, no custom domain on the bucket. Every read goes through the Worker
(`/api/admin/photos/<id>/<size>` now; `/p/<id>/<size>` with branch-cookie checks in Phase 3), always `no-store` when gated.

| Prefix | What | Written by | Lifetime |
|---|---|---|---|
| `photos/orig/<photoId>.webp` | full photo, max 2048 px, WebP, no EXIF | admin upload (browser re-encode, server re-checks for EXIF/XMP) or promotion from `clean/` | until deleted; soft delete then purged after 30 days by the cron |
| `photos/thumb/<photoId>.webp` | 400 px thumb | admin upload | same as above |
| `quarantine/<uploadId>` | raw bytes from the in-branch request form (Phase 3) | Worker, only after magic-byte check (JPEG/PNG/WebP/HEIC, max 10 MB, no SVG) | never served; deleted after 90 days (or once re-encoded/rejected) |
| `clean/<uploadId>.webp` | server-side re-encode of a quarantined upload (Images binding) | Worker | admin reviews, then promotes to `photos/` or deletes; 90-day purge |

D1 rows (`photo`, `upload_quarantine`) hold keys, never URLs. Backups bucket (`teamlancaster-backups`, Phase 5) shares the 10 GB free allowance, so plan for about 10k photos.
