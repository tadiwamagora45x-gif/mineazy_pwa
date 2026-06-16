# Mineazy Sales Assistant - PWA

A Progressive Web App for industrial sales representatives.

## Quick Start

Serve with any static file server:

```bash
# Python
python -m http.server 8080

# Node
npx serve .

# Or just open index.html directly in Chrome/Edge
```

Then open `http://localhost:8080` on your phone (same WiFi network).

## Installing on Android

1. Open the app in Chrome
2. Tap the "Add to Home Screen" prompt (or Chrome menu > Add to Home Screen)
3. The app installs as a full-screen native-like app

## Installing on Desktop

1. Open in Chrome/Edge
2. Click the install icon in the address bar

## Features

- Product search (name, SKU, part number, barcode)
- Cart management with quantity controls
- Picking mode with checklist and progress tracking
- Cart summary with ERP submission
- Dashboard with stats and recent orders
- Offline mode with IndexedDB storage
- Barcode scanner (camera + manual entry)
- Service worker for offline support
- Installable as a native app (PWA)

## Demo Login

Any username/password works - it's a client-side demo with sample data.

## Connecting to Real ERP

Edit the `API_BASE` constant in `app.js` to point to your backend.
