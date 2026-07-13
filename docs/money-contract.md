# Money Contract

## Canonical Rules

1. All commercial booking, quote, rental pricing, insurance, promotion, payment, refund, and customer-spend calculations use **JMD amounts at scale 1**.
2. Several legacy database columns and pricing JSON keys in the commercial domain end in `_cents`, but their values are whole JMD amounts. The suffix does not authorize dividing or multiplying by 100.
3. Fleet acquisition, depreciation, and maintenance accounting use **true JMD minor units at scale 100**.
4. WiPay and other provider payloads receive decimal strings derived from commercial JMD amounts, such as `6500.00` for JMD 6,500.
5. Arithmetic stays numeric until the display or provider boundary. Formatting must not feed another calculation.
6. Percentage discounts round once to the nearest JMD amount. Totals, balances, and refunds must use the same stored pricing snapshot.

## Domain Matrix

| Domain | Stored unit | Scale | Examples |
| --- | --- | ---: | --- |
| Vehicle rental pricing | JMD amount | 1 | `vehicles.daily_rate_cents`, `vehicles.deposit_cents` |
| Booking pricing snapshot | JMD amount | 1 | `pricing_json.total_cents`, `base_total_cents`, `promo_discount_cents` |
| Insurance and promotions | JMD amount | 1 | `price_per_day_cents`, fixed discounts, minimum subtotal |
| Payments and refunds | JMD amount | 1 | `payments.deposit_amount_cents`, refund amounts |
| Quotes | JMD amount | 1 | quote totals and deposits ending in `_cents` |
| Vehicle finance/depreciation | JMD minor units | 100 | purchase cost, residual value, book value |
| Maintenance costs | JMD minor units | 100 | labor, parts, tax, and total costs |

## Required Helpers

- `readStoredJmdAmount`: read legacy commercial values without scaling.
- `formatJmd` / `formatJmdDecimal`: display or serialize commercial JMD amounts.
- `jmdMinorUnitsToAmount`: convert true fleet-accounting minor units to JMD.
- `jmdAmountToMinorUnits`: convert fleet-accounting form input to true minor units.
- `formatJmdFromMinorUnits` / `formatJmdDecimalFromMinorUnits`: format true minor-unit values.

Do not introduce new direct `/ 100` or `* 100` money conversions outside `src/lib/money.ts`.

## Naming For New Work

- Use `amountJmd`, `totalJmd`, or an equivalent `_jmd` name for scale-1 commercial values.
- Use `minorUnits` or `_minor_units` for scale-100 values.
- Do not create new `_cents` names. Existing names remain for compatibility until a separately planned schema migration can rename them safely.
