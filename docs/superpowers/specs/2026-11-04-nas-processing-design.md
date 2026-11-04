# NAS processing

Intent: reduce large-video disk work while preserving selected codecs, subtitles, chapters, artwork, SponsorBlock cuts, and playback behavior.

Approach: retain yt-dlp and its postprocessors, adding a bundled Python plugin and a Node-owned processing gate. A loopback connection holds a processing permit; disconnect/exit releases it, so crashed processes cannot leave a stale lock. Downloads remain concurrent. All app-owned heavy FFmpeg operations use the same gate, including live splitting. Defaults: one processing permit, configured by MAX_CONCURRENT_POSTPROCESSORS (1–4); NAS_POSTPROCESSING=0 disables the plugin optimizations.

The plugin reports named waiting/start/finish events independently of quiet mode. Persist each stage start timestamp, show elapsed time across reconnects, and log per-stage duration. Never fabricate a percentage or ETA from stage boundary events. A queued processing task is healthy even if it uses no CPU.

Fuse metadata into the merger only for MP4 jobs with metadata enabled and no subtitles, chapter embedding, SponsorBlock removal, custom postprocessor arguments, or later splitting. Reuse upstream metadata generation and retain the normal pipeline whenever fusion is inapplicable. Otherwise omit intermediate MP4 fast-start only when a later metadata rewrite is guaranteed; retain final fast-start.

Optional YTDLP_WORK_DIR stages ordinary VOD downloads under per-job directories, then lets yt-dlp move final files home. Default stays unchanged; live captures keep their existing paths for stop/recovery safety. Use relative templates plus explicit home paths because absolute templates bypass yt-dlp temp paths. Preserve incomplete work for retries; clean only empty work directories after successful completion. Check configured work directory writability and available space before download when size is known.

Alternatives: reducing whole-job concurrency also serializes network work; replacing all postprocessing would duplicate codec/container handling. Retaining upstream processing with selective wrapping is narrower and supports existing behavior.

Verification: real Python plugin tests and synthetic FFmpeg fixtures; gate cancellation/disconnect/failure tests; CLI/progress/queue tests; client elapsed-time tests; full server/client suites, builds and lint. NAS speed gains require measuring a real deployment; local tests prove behavior and eliminated passes, not HDD throughput.
