# Product

## Register

product

## Users

EV drivers who charge in public, mostly in Germany and the rest of Europe. They plan a stop before they leave, or decide on the road, and open the app with one hand: phone in a car holder, or in hand at the bay, often in daylight glare or under car-park lights. Their worry is concrete: "Will the charger actually be free when I get there?" Secondary audiences are the hackathon jury, who watch a live demo on a laptop or projector, and Charge Point Operators (CPOs) judging whether reservations raise utilisation.

The job: find a charger, reserve the Ecurious-equipped bay, drive there, get checked in automatically by the camera reading the plate, charge, and leave.

## Product Purpose

Ecurious Reserve puts the Ecurious reservation hardware into a charging app. The physical device keeps a bay free for the driver who booked it, and the camera releases it when the right car arrives. Public charger data comes from GoingElectric. Success means the driver trusts the guarantee ("my spot is kept free") and the whole reserve → arrive → charge → release cycle works live on the real bay without any explaining.

## Brand Personality

The app uses Ecurious's own brand system, taken from ecurious.com on 2026-10-24. DESIGN.md holds the tokens and rules.

- **Look:** warm paper and blue-black ink, with one spark of voltage lime and ultraviolet wherever the accent has to be read on light.
- **Type:** Bebas Neue capitals for headlines and big numbers, Space Grotesk for reading, and JetBrains Mono for labels, buttons and prices.
- **Shape:** pill buttons, flat surfaces and hairline-ruled grids.
- **Character:** dependable, calm, precise.
- **Voice:** Ecurious's voice is confident and plain. Headlines are short and declarative and end with a full stop, numbers are concrete, and copy is English first, with formal "Sie" in German. Inside the app it speaks like a well-run car park attendant: short sentences, concrete 24-hour times ("Held until 14:35"), no hype.
- **Emotional goal:** relief, because the uncertainty of public charging goes away.
- **Logo:** the Ecurious logo appears only as a "Powered by Ecurious" credit set in our type until Ecurious approves using the wordmark. Their Ë mark is never recreated.

## Anti-references

- The first prototype: a bare full-screen map with a floating white box, no hierarchy, no entry point.
- Generic SaaS dashboard templates: hero-metric cards, identical icon-card grids, purple gradients.
- Cluttered charging apps where promos, filters and toasts fight the map.
- "EV tech" clichés: neon-on-black, lightning-bolt gradients, glassmorphism.

## Design Principles

1. **Availability is the headline.** Whether the bay is free, held for you, or taken must be readable at a glance, from text and shape and not from colour alone.
2. **One next step per screen.** Each screen has a single obvious primary action (Reserve, Navigate, Start charging, Finish).
3. **Honest data.** Only the Ecurious bay is reservable; public chargers are clearly info-only. Never imply availability we can't guarantee.
4. **Privacy you can see.** Explain plate recognition where it happens, ask consent once, and show that the plate is deleted after the session.
5. **Built for the road.** Large touch targets, short copy, high contrast, nothing that needs two hands or a second look.

## Accessibility & Inclusion

WCAG 2.2 AA. Touch targets of at least 44px, a usable layout from 360px wide, full keyboard support, visible focus, status changes announced with `aria-live`, and `prefers-reduced-motion` respected. Status is never shown by colour alone, and contrast holds up in sunlight. English UI copy for now.
