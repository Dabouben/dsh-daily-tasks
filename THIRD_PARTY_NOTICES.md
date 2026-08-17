# Third-Party Notices

This project adapts implementation ideas from the following MIT-licensed
projects. Attribution is required by the MIT License:

## dsh-usage-dashboard-plus / dsh-usage-dashboard

- https://github.com/1HelloMan1/dsh-usage-dashboard-plus (MIT)
- https://github.com/1690834643/dsh-usage-dashboard (MIT)

Used for: the session-log usage aggregation approach (zstd frame
decompression, `assistant/message` usage event parsing, per-model token
accounting) and the DeepSeek balance query approach (credentials resolution
and `/user/balance` response mapping) in `src/usage.ts`.

The DeepSeek price table (CNY per 1M tokens) with the peak/off-peak schedule
effective 2026-08-17 is based on the pricing data published in those projects
and DeepSeek's official pricing.
