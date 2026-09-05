# Cannula Mobile Developer Guide

Implementation-ready Patient app documentation derived from the current backend. Executable controllers, validators, services, formatters, and schemas are authoritative; this guide does not describe planned behavior.

## Quick Start

- [Getting started, transport, dates, caching](01-getting-started.md)
- [Demo data and account](16-mobile-demo-data.md)

## Demo Account

Seeded development credentials: phone `07700000000`, PIN `123456` (**DEMO ONLY**). See [Mobile demo data](16-mobile-demo-data.md).

## Authentication

- [Authentication, sessions, headers, refresh, recovery](02-authentication.md)
- [Profile and health](03-profile-and-health.md)
- [Children](04-children.md)

## API Reference

- [Compact inventory of all 66 routes](mobile-api-reference.md)
- [Specialties](05-specialties.md)
- [Doctors and availability](06-doctors.md)
- [Appointments](07-appointments.md)
- [Home Care](08-home-care.md)
- [Pharmacy treatment requests](09-pharmacy-treatment-requests.md)
- [Favorites](12-favorites.md)
- [Suggestions and reference data](13-suggestions-and-reference-data.md)
- [Ads and About Us](14-ads-and-about-us.md)

## Core Flows

Appointment, Home Care, Pharmacy, authentication, upload, notification, and favorite Mermaid flows live in their domain chapters. The [integration checklist](17-mobile-integration-checklist.md) contains the screen-to-API matrix and empty/loading-state guidance.

## Images/Uploads

- [Uploads and images](11-uploads-and-images.md)

## Notifications

- [Notification inbox, types, read state, deep links](10-notifications.md)

## Errors

- [HTTP handling, domain codes, and enum appendix](15-errors-and-status-codes.md)
- [Known backend integration issues](KNOWN_BACKEND_INTEGRATION_ISSUES.md)

## Postman

- [Collection](cannula-mobile.postman_collection.json)
- [Local environment](cannula-mobile.postman_environment.json)

## Optional Flutter Guidance

- [Flutter model mapping and API client grouping](18-flutter-model-mapping.md)

## Integration Checklist

- [Screen matrix and phase checklist](17-mobile-integration-checklist.md)

## Canonical URLs

| Environment | API base | Mobile base |
|---|---|---|
| Production | `https://api.cannula.app/api` | `https://api.cannula.app/api/mobile` |
| Local | `http://localhost:3001/api` | `http://localhost:3001/api/mobile` |

Define one client `baseUrl`; examples use `{{baseUrl}}/mobile/...`.

