# Experiment design: does a nudge raise the pin-select rate?

Status: **design only, not implemented.** The variant code is not in the site.
It gets built only if the decision at the end says the test is worth running.

## Background

The point of the homepage is for visitors to stay on the map and open pins.
The one conversion event the site has is a visitor selecting a pin
(`pin_select`, see the README for the event list). Traffic is small, about 50
visitors and 180 page views a month, so this doc is as much about whether a
test is feasible as about the test itself.

## Hypothesis

If the page gives a visitor a reason to tap a pin, more sessions will select at
least one pin. Two candidate nudges:

- **A. Auto-open the latest check-in.** On load, once the map settles, the
  pin holding the most recent check-in opens its panel.
- **B. A "tap a pin" hint** shown on first load, dismissed on first pin tap.

Variant A is the one to test first: it is the stronger intervention, and it
needs no new UI, only existing behaviour triggered earlier.

## Design

| | |
|---|---|
| Unit | Session (a random per-tab id; there is no persistent visitor id) |
| Assignment | 50/50 on a hash of the session id, so a session stays in one arm. Logged as a `variant` property on every event |
| Control | Today's page, nothing opens on load |
| Treatment | Latest check-in's panel opens ~2 seconds after the map settles |
| Primary metric | Pin-select rate: sessions with at least one `pin_select` / sessions with a homepage `page_view` |
| Guardrail | Median `ms_on_page` per session must not drop, and `session_end` with `pins_selected = 0` must not rise |
| Exclusions | Your own visits (opt-out flag and admin cookie), bots, anything not `env = 'production'` |

One caveat: with a per-tab id, one person can be several sessions, so the arms
are not strictly independent. At this traffic level that is a limitation to
state, not one worth engineering around.

## Sample size

Two-sided test on two proportions, alpha = 0.05, power = 0.80.

```
n per arm = (z_alpha/2 + z_beta)^2 * (p1(1-p1) + p2(1-p2)) / (p1 - p2)^2
          = (1.96 + 0.84)^2 * (0.50*0.50 + 0.65*0.35) / (0.15)^2
          = 7.85 * 0.4775 / 0.0225
          ~ 167 sessions per arm  (about 334 in total)
```

The baseline (50%) is an assumption until real data exists. Check it against
query 2 in `analysis.sql` first. The required size moves a lot with the
baseline and the lift you care about:

| Baseline | Target | Sessions per arm |
|---|---|---|
| 50% | 65% (+15 points) | ~167 |
| 50% | 60% (+10 points) | ~385 |
| 40% | 50% (+10 points) | ~385 |
| 50% | 55% (+5 points) | ~1,565 |

## Duration

At about 50 visitors a month, roughly 334 sessions takes **about 6 to 7
months**, and a smaller lift takes years. The trip this site tracks ends on 8
January 2027, and traffic is likely to fall well before then. A properly
powered test is therefore **not feasible on this site**.

## Decision rule

Decided up front, so the result cannot be talked into meaning something:

1. Do not call a winner before the sample-size target is reached for both arms.
2. If the target is reached, ship the treatment if the pin-select rate is higher
   with a 95% confidence interval that excludes zero **and** the guardrail has
   not worsened.
3. If the target is not reached (the expected outcome), report it as
   "underpowered": show both rates with their n and the interval, say that it is
   directional only, and do not ship on that basis.

## Recommendation

Do not run this as a live test on this site. Keep the design and the sizing as
the deliverable. If a nudge is wanted anyway, ship it as a plain change and
watch the pin-select rate (query 2) before and after, labelled clearly as a
before/after comparison, not an experiment.
