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

Run `node tests/ui.cjs` to verify that incremental worker results do not show
or move the arrow, that final results display once, and that stale replies are
ignored after cancellation. It also checks step-by-step captures, branching
routes, promotion during a capture, undo, reset, and SVG geometry in both board
orientations. This uses a minimal
DOM harness, not a browser rendering test. The worker also runs a real 500 ms
search and reports first-hint latency and final response time.

The UI displays search progress but only draws the final completed result.
The default fast mode uses a
1-second search budget; deep mode retains the original 4.5-second budget. The
shorter budget can reduce completed depth and move quality; choose deep mode
when analysis quality matters more than latency. No provisional arrows are
displayed. Selecting a piece, undoing, starting a game or
changing sides terminates the old worker so obsolete analysis cannot overwrite
the current board's hint.

A capture is committed to history as one move. Its intermediate landings are
selected from full legal routes generated for the original position; the UI
does not regenerate routes from a partially captured board. This retains
the original engine's capture and promotion behavior.
