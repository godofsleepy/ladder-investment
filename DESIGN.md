# Ladder design direction

Owner's direction: a sibling of Guardian Finance, so the two feel like one family.

The source of truth is the Ladder design canvas: https://claude.ai/artifact/ThhQ1auPfuZiWvAHqK13gN. Its Login and Account boards are built as drawn, with the differences listed below. Its main boards are not fully built yet: see "Differences from the canvas".

Reading this as: personal investing dashboard for one long-term investor, in Guardian Finance's calm blue language. Dial: ENERGY 1 / RHYTHM 2 / MOTION 1.

The source of truth is the Ladder design canvas: https://claude.ai/artifact/ThhQ1auPfuZiWvAHqK13gN. The "without ACP" board, Login and Account are built as drawn, with the differences below.

| Decision | Choice | Why |
|---|---|---|
| Color | Guardian's tokens, plus darker text shades for tinted badges | The sibling look, and badge text has to pass WCAG AA |
| Type | Guardian's system font stack, tabular figures on every number | Same family feel; columns of rupiah must line up |
| Theme | Light by default, dark on the Account page | No reason to force one theme |
| Motion | Hover and focus states only | Calm tool, nothing to animate |

## Differences from the canvas

- Growth uses real closes, not the canvas's generated curve, so it's flat wherever Ladder has no data.
- Log trade offers "New asset", since a new account has nothing in the list.
- Empty values read "Not set" and an in-zone distance reads "Inside", replacing the canvas's em dashes.
- Rupiah is the default for crypto, where the canvas shows dollars, because Indodax trades in rupiah.
- Holdings has an "Other" filter only when you hold something in it.
- Sign-up has no Terms and Privacy Policy line, because those pages don't exist.
- Create account signs in straight away, with no email confirmation.
- Account adds a Theme row. Its profile and two-step sections aren't drawn on the board, so they aren't built.
- Journal labels notes from an agent "Assistant", where the canvas says "Ladder alert", because they aren't always alerts.
- Phones get a bottom bar and a Prices card under Holdings, which the desktop-only board doesn't show.
- The Trade log's Cash filter reads "Deposits & fees". Ladder has no cash ledger: a deposit brings a holding in at cost, so there are no cash deposits or withdrawals to show.
- Trade log net amounts include fees, and USD trades convert at the rate on the trade date, where the canvas uses gross amounts at today's rate.
- Phones get a five-item bottom bar, with "Trades" as the short label and counts on the item's corner.
