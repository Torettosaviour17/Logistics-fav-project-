# LogisticsFav

Logistics management and shipment tracking MVP based on the supplied university defense guide.

## Stack

React + Vite + Tailwind CSS, Node.js + Express, MongoDB/Mongoose and JWT authentication.

## Roles

- Customer: create, view and track own shipments.
- Driver: view assigned deliveries and update valid statuses.
- Admin: inspect operations and assign drivers.

## Shipment workflow

Pending -> Assigned -> Picked Up -> In Transit -> Out for Delivery -> Delivered

Optional failure/cancellation states are supported by the backend.

## Project structure

- `client/` React frontend
- `server/` Express API and MongoDB integration

## Local setup

1. Create `server/.env` from `server/.env.example`.
2. Set a MongoDB connection string and a strong JWT secret.
3. Run `npm install` in the root, `client`, and `server` folders.
4. Run `npm run dev` from the root.

For a first admin/driver setup, configure the seed variables described in `server/scripts/seed.js` and run `npm run seed` inside `server`.

## API

- POST `/api/auth/register`
- POST `/api/auth/login`
- GET `/api/auth/me`
- GET/POST `/api/shipments`
- GET `/api/shipments/:id`
- PATCH `/api/shipments/:id/status`
- PATCH `/api/shipments/:id/assign`
- POST `/api/shipments/:id/location`
- GET `/api/users/drivers`
- GET `/api/track/:trackingNumber`
