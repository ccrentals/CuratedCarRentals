# Google Play Data safety draft

This is an implementation-based worksheet, not a completed Play Console declaration. The business owner must verify retention, deletion, legal requirements and every production service before submission.

## Collection and sharing summary

- Data is encrypted in transit over HTTPS.
- The app does not sell personal data or use third-party behavioural advertising.
- The app does not request precise location, contacts, photos, microphone, camera or advertising identifiers.
- Payment-card details are entered on WiPay's hosted checkout and are not collected by the app.
- Cloudflare Turnstile receives technical security data during the one-time booking security challenge.
- A private booking-access credential is stored in Android encrypted secure storage and can be removed from My Booking.

## Data used for app functionality

| Play data category | Example fields | Required? | Purpose |
| --- | --- | --- | --- |
| Personal info — Name | First and last name | Yes for a reservation | Create and administer the rental |
| Personal info — Email address | Customer email | Yes for a reservation | Confirmation and customer support |
| Personal info — Phone number | Customer phone | Yes for a reservation | Rental coordination and support |
| Personal info — Address | Optional delivery address | Only when delivery is selected | Arrange vehicle delivery |
| Personal info — Other information | Signature and optional notes | Yes/optional as shown in the form | Rental authorization and fulfilment |
| Financial info — Purchase history | Quote, deposit amount and payment status | Yes for a reservation | Process and reconcile the booking |
| App activity — Other user-generated content | Rental dates, vehicle, locations, insurance choice | Yes for a reservation | Availability, pricing and fulfilment |
| App info and performance / Device or other IDs | Network and browser/device security signals during Turnstile | Collected by the security provider | Fraud prevention and abuse protection |

## Data handling notes

- Reservation data is sent to Curated Car Rentals' production API only after the user reviews and submits the booking.
- WiPay processes hosted payment details under its own terms. The app receives or retrieves only booking/payment status needed to complete the reservation.
- Cloudflare Turnstile is opened on the approved Curated Car Rentals domain because its security challenge requires a browser context.
- Removing the encrypted credential from the device does not cancel a reservation or erase business records.
- Privacy requests are directed to `info@curatedcarrentals.com`; the business must confirm the operational deletion-request process and retention schedule before Play submission.

## Play Console answers requiring owner/legal confirmation

- Whether each category is treated as "collected," "shared," or both under Google's current definitions for service providers.
- Exact retention periods and which records must be retained for accounting, fraud, insurance or legal obligations.
- Whether users can request deletion through email alone or whether an external account/data-deletion URL is required.
- Final privacy terms for WiPay, Cloudflare, hosting, email and any analytics or crash-reporting service added before release.
- Whether identity, driver's licence or insurance documents will be collected in a later production workflow; the current Android app does not request file, photo or camera permissions.
