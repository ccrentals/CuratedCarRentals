# Curated Car Rentals Android app

Native React Native application for Curated Car Rentals, built with Expo SDK 57, Expo Router, and TypeScript. The interface uses native views and controls; it is not a WebView wrapper.

## Run locally

Requirements: Node.js 22.13 or newer LTS, npm, and either Expo Go on Android or a configured Android SDK/emulator.

```bash
npm install
npm run typecheck
npm start
```

Scan the Metro QR code with Expo Go, or run `npm run android` when an Android emulator is available.

## App routes

- Home, Fleet, Book, and More are primary native tabs.
- Vehicle details are available at `/fleet/[id]`.
- My Booking securely restores the latest reservation and payment status on the device.
- Services, Tourist Destinations, Rental Policies, Driving in Jamaica, About, and Contact are native stack screens.

## Android release

- Application ID: `com.curatedcarrentals.app`
- Deep-link scheme: `curatedcarrentals://`
- Version: `1.0.0` / version code `1`
- Production output: Android App Bundle (`.aab`)

Run `npm run build:android` after signing into the Expo account that will own the project. The production EAS profile automatically increments the Android version code. Google Play Console access, store listing content, privacy/data-safety declarations, and final signing ownership are required before submission.

## Integration status

The application uses `https://curatedcarrentals.com` by default and can be pointed to another deployment with `EXPO_PUBLIC_API_BASE_URL`. Fleet inventory, date availability, minimum rental days, pickup/return locations, insurance, and quote totals come from the live public APIs. If the fleet request is unavailable, the native catalogue remains usable as an explicitly labelled offline fallback.

Booking is a native flow: it collects trip/customer details, captures a signature, completes a one-time Cloudflare security handoff, creates the real reservation, stores the private booking credential in Android secure storage, and launches WiPay’s hosted payment page for the deposit. The My Booking screen refreshes server status after payment.

The website companion changes must be deployed before live booking from the app is enabled:

- `/mobile/booking-security` must be served from the production Turnstile-approved domain.
- Booking status and WiPay start endpoints must accept the per-booking Bearer credential.
- WiPay still completes in its hosted browser flow; after payment, the customer closes that page and the app refreshes the server-confirmed status.

## Local release artifact

The verified local bundle is generated at `android/app/build/outputs/bundle/release/app-release.aab`. It is useful for build verification but uses the generated local development keystore. Do not upload that artifact as the production release. Create the Play-owned/EAS production signing credentials first, then run the production EAS build.

Before Play submission, the owner must provide or approve:

- Expo/EAS project ownership and Android production signing key
- Google Play Console application and service-account access
- privacy-policy URL, Data safety answers, content rating, target countries, pricing, screenshots, feature graphic, and store copy
- closed-testing enrollment and Google Play review
