# Confluence Easton

A free public app for downtown Easton, PA: events, a map, businesses, creative services, artists, and Day & Night guides.

- `/` is the app. It works in any phone browser and can be added to the home screen.
- `/join/` is the sign-up page for businesses, creatives, artists and events. It's the page to show people when you collect listings.
- `/thanks/` is where people land after sending the form.

There is no build step. Netlify publishes the `site/` folder as is.

## Artwork rule

**Never use any graphic as is, and never promote one.** Licensed packs (like CinCin) and other reference material can inspire the app's art, but their drawings don't go in as they are: not cropped, traced, recolored, masked or lit up as neon. They're also never featured, credited as the app's art or shown off in its marketing. What ships is drawn new for this app.

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

## Takeovers

Listings are free. Takeovers are the one spot you can book, and the app always labels them. Everything lives in `site/data/takeovers.json`:

- **Business weeks** (4 a month): add `{"weekOf": "2026-11-09", "place": "<listing id>", "headline": "...", "offer": "..."}`. `weekOf` is that week's Monday. The business's sign sits at the top of Today for the week, and its listing gets a Takeover tag.
- **Artist months** (1 a month, a trade): add `{"month": "2026-12", "artist": "<artist id>", "headline": "...", "art": {"banner": "/photos/december.jpg", "alt": "..."}}`. With a banner, the artist's art takes over the top of Today with a credit.
- **Seasons** (Christmas): set the dates, `vendorSpots`, and add vendors as `{"place": "<listing id>", "offer": "..."}`. During the season the neon goes red and green, snow falls, and Today gets a holiday vendors section. Your own seasonal art goes in `art.banner`.
- **Prices**: set `prices.businessWeek` and `prices.vendorSpot` to numbers to show them on the booking page; leave them `null` to show "Ask about pricing".

Requests come in through the booking page at `/takeovers/` and land in Netlify under **Forms → takeover**. Nothing is booked until you add it to the file. Approve, invoice, and add it once it's paid.

## Time of day and weather

The app follows Easton's real sun. Sunrise and sunset are worked out in the app itself (NOAA's sunrise equation, good to a minute or two), so this works offline. From them it picks one of five looks, checked every minute:

| Phase | When | Look |
| --- | --- | --- |
| Dawn | 40 minutes before sunrise to 50 after | pink-blue wash, signs fading off |
| Daylight | the rest of the day | sunlit brick, neon switched off (OPEN signs stay lit) |
| Golden hour | 75 minutes before sunset to 10 after | orange wash, signs warming up |
| Blue hour | 10 to 55 minutes after sunset | deep blue wash, signs on |
| Night | until dawn | full neon |

The windows are in `phaseAt()` in `site/assets/app.js`; the looks are at the end of `site/assets/app.css`.

The weather on Today comes from the [National Weather Service](https://www.weather.gov/): free for any use (including a business), no account or key, refreshed every 30 minutes. If the weather can't load, the panel still shows the sun's arc and the next sunrise or sunset.

## The photo at the top of Today

The top of the Today screen shows a real photo of an Easton sign, with the neon Confluence name over it. Save the photo in `site/photos/` and fill in `heroPhoto` in `site/data/settings.json`:

```json
"heroPhoto": {"src": "/photos/hero.jpg", "alt": "The Lafayette Bar sign on Northampton Street at dusk", "credit": "Photo: Jane Doe"}
```

`alt` describes the photo for people using screen readers; `credit` shows in the photo's corner (leave it empty to hide it). With no photo, Today opens with the neon name alone.

## Example content

Everything marked `"example": true` is sample content to show how the app works. When enough real listings are in, set `"showExamples": false` in `site/data/settings.json` and every example disappears at once, including any guide that relied on one.

Real places (Centre Square, the State Theatre, the Easton Public Market and the other landmarks) are not examples. Pins marked `"approx": true` were placed from street addresses and should be checked with `#pick` before launch. The Public Market's hours came from the City of Easton's website; confirm them with the market.

## Notes

- Map tiles come from OpenStreetMap, which is fine for a launch. If the app gets heavy traffic, switch to a tile provider with a free tier (such as MapTiler or Stadia Maps) by changing the one `L.tileLayer` line in `site/assets/app.js`.
- The map library (Leaflet 1.9.4) and fonts (Bebas Neue, League Spartan and Barlow Condensed under the SIL Open Font License, and Yellowtail under the Apache License 2.0; each license file sits beside the fonts) are stored in the repository, so the site doesn't depend on outside services to load.

## The look

The app is styled as Easton's old signs after dark: rusted enamel, night brick, and neon tubes that are mostly lit, with a few burned out or flickering. The materials and neon colors live in `site/assets/base.css`; the app's layout is in `site/assets/app.css`. Headlines get their worn tubes from the `wear()` function in `site/assets/app.js`, which picks the letters from the words themselves, so a given word always wears the same way. Flickering stops for anyone whose device asks for reduced motion.

Dark Martha Stewart's brand shows up in the look, never as extra copy: the ballpoint ink trail (`site/assets/ballpoint.js`, the same one as marthathinkstoomuch.com), her lime for saved things, the research assistant drawn in chalk on the Day & Night screen, and a small hexagon maker's mark. Permanent Marker is under the Apache License 2.0.
