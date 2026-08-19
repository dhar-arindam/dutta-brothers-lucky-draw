# Dutta Brothers Festive Lucky Draw

Status: APPROVED  
Owner: Principal Software Engineer  
Version: 1.3  
Last Updated: 2026-08-19
Change: Final Admin V1 consolidation  
Reason: Approved source-of-truth alignment across specs

## Product Overview

**Product Name:** Dutta Brothers Festive Lucky Draw

**Purpose:** A mobile-first lucky draw application for Dutta Brothers Electronics during the Durga Puja + Diwali festive sales campaign.

## Summary

This product provides customers with an engaging digital lucky draw experience at the point of sale. Customers access the draw from their own mobile phones using a mobile web browser.

The system contains two core experiences:

1. **Customer Lucky Draw** — A mobile-first interface where customers enter their details (name, phone, bill number) and use a festive reveal interaction to discover their backend-selected prize.

2. **Shop Owner Admin Operations Page** — An operational interface where shop owners can view draw statistics, successful claims, manage prize configuration, and export reports.

## Key Characteristics

- **Mobile-first:** Optimized for small smartphone screens (360px–430px)
- **Web-based:** No app installation required; accessed via mobile browser
- **Stateless draws:** No requirement to track prize inventory or stock
- **Relative prize weights:** Prizes use relative weighted selection, not percentage allocation
- **Backend-driven:** Prize selection occurs server-side; frontend only visualizes the result
- **Simple operations:** Minimal admin requirements with direct admin access in V1
- **Admin UX simplicity:** Admin page opens directly without login, token, or session workflow
- **Festive theme:** Durga Puja + Diwali design direction for premium, celebratory aesthetic

## Business Context

This is a seasonal campaign application. It is intended to be:

- Simple
- Reliable
- Maintainable
- Inexpensive to operate

No over-engineering.
