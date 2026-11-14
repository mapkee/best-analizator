Run `node tests/engine.cjs` from the repository root with Node.js and Git installed.

The original engine is loaded from commit
`95a7f5b511a1972e50e6e03007663bb46915b38a`, so keep that commit in local history.
The suite compares generated moves and resulting boards during deterministic
playouts and on 600 synthetic boards. On 20 positions it compares depth-5
search results, including score, selected path and node count. It warms both
engines and prints three timing rounds, alternating execution order.

Observed locally with Node.js 24: baseline 416–467 ms, optimized 327–357 ms
per batch of 20 searches (1.17–1.43x). Browser and device results may differ.
The benchmark uses fixed depth, not time-limited iterative deepening; it does
not establish playing strength or prove equivalence on every possible board.

These optimizations preserve the existing move rules and evaluator. Existing
rule interpretation and quiescence behavior have not been independently
validated against an official draughts rules reference.

Run `node tests/ui.cjs` to verify incremental worker results, selecting and
playing a move during analysis, ignoring stale replies after cancellation,
and valid SVG route geometry in both board orientations. This uses a minimal
DOM harness, not a browser rendering test. The worker also runs a real 500 ms
search and reports first-hint latency and final response time.

The UI displays each completed search iteration while retaining the original
4.5-second analysis budget. Early hints are provisional; their move can change
as deeper iterations finish. Selecting a piece, undoing, starting a game or
changing sides terminates the old worker so obsolete analysis cannot overwrite
the current board's hint.
