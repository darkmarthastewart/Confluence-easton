# Confluence Easton

A free public app for downtown Easton, PA: events, a map, businesses, creative services, artists, and Day & Night guides.

- `/` is the app. It works in any phone browser and can be added to the home screen.
- `/join/` is the sign-up page for businesses, creatives, artists and events. It's the page to show people when you collect listings.
- `/thanks/` is where people land after sending the form.

There is no build step. Netlify publishes the `site/` folder as is.

## Put it online (Netlify)

1. In Netlify, choose **Add new site → Import an existing project** and pick this repository. The settings come from `netlify.toml`, so there's nothing to fill in.
2. Turn on forms: **Site configuration → Forms → Enable form detection**, then deploy again so Netlify finds the `listing` form.
3. Get an email for every sign-up: **Forms → Form notifications → Add notification → Email notification**.
4. Optional: add your domain under **Domain management**.

## Turning a sign-up into a listing

Sign-ups arrive in Netlify under **Forms → listing**, with any photo attached. Nothing goes live automatically. You check each one first, then add it to a file in `site/data/`:

| Listing type | File |
| --- | --- |
| Business, landmark, park | `places.json` (`type`: `food`, `shop`, `landmark` or `outdoors`) |
| Creative service | `places.json` (`type`: `creative`) |
| Artist | `artists.json` |
| Event | `events.json` |
| Day & Night plan | `guides.json` |

A business looks like this:

```json
{"id":"rivertown-bagels","name":"Rivertown Bagels","type":"food","sub":"Bagels · Breakfast","price":"$",
 "addr":"12 Centre Square, Easton, PA","lat":40.69125,"lng":-75.20905,
 "hours":{"default":"07:00-14:00","mon":"closed"},
 "url":"https://instagram.com/rivertownbagels","phone":"(610) 555-0100",
 "photo":"/photos/rivertown-bagels.jpg",
 "blurb":"Kettle-boiled bagels and schmears, made every morning."}
```

- **`id`**: lowercase words joined by hyphens. Must be unique.
- **`hours`**: 24-hour time ranges. `default` covers every day not named separately; days are `sun` `mon` `tue` `wed` `thu` `fri` `sat`. Use `"closed"` for days off and `"17:00-02:00"` for places open past midnight. Leave `hours` out entirely if it doesn't apply.
- **`photo`**: save it in `site/photos/` and point to it.
- **Creatives** also take `"tags":["Logos","Menus"]` and `"rate":"From $175"`.
- **Events** take either `"date":"2026-11-14"` with `"start"` and `"end"`, or a `"repeat"` rule like the farmers' market entries. Events show for the next two weeks.

### Placing a pin

Open the app with `#pick` at the end of the address (for example `https://your-site/#pick`), go to the spot on the map, and tap it. The app shows the latitude and longitude to copy into the listing.

## Example content

Everything marked `"example": true` is sample content to show how the app works. When enough real listings are in, set `"showExamples": false` in `site/data/settings.json` and every example disappears at once, including any guide that relied on one.

Real places (Centre Square, the State Theatre, the Easton Public Market and the other landmarks) are not examples. Pins marked `"approx": true` were placed from street addresses and should be checked with `#pick` before launch. The Public Market's hours came from the City of Easton's website; confirm them with the market.

## Notes

- Map tiles come from OpenStreetMap, which is fine for a launch. If the app gets heavy traffic, switch to a tile provider with a free tier (such as MapTiler or Stadia Maps) by changing the one `L.tileLayer` line in `site/assets/app.js`.
- The map library (Leaflet 1.9.4) and fonts (Bebas Neue, League Spartan and Barlow Condensed under the SIL Open Font License, and Yellowtail under the Apache License 2.0; each license file sits beside the fonts) are stored in the repository, so the site doesn't depend on outside services to load.

## The look

The app is styled as Easton's old signs after dark: rusted enamel, night brick, and neon tubes that are mostly lit, with a few burned out or flickering. The materials and neon colors live in `site/assets/base.css`; the app's layout is in `site/assets/app.css`. Headlines get their worn tubes from the `wear()` function in `site/assets/app.js`, which picks the letters from the words themselves, so a given word always wears the same way. Flickering stops for anyone whose device asks for reduced motion.
