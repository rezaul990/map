# Bangladesh Travel Map

A simple travel map for marking the districts of Bangladesh you have visited and downloading your personalized map.

## Features

- Bangladesh map with 64 districts and click-to-toggle visit tracking
- 9 color themes
- Export to PNG, JPG, or PDF
- Search districts by English or Bengali name
- Select all or clear selections
- Custom name and profile image
- Automatic saving in the browser with localStorage
- Visit progress indicator
- Copy travel data as JSON

## Tech

- Vanilla HTML, CSS, and JavaScript — no framework
- Pure SVG map rendering — no external map service or API key
- Bangladesh district boundaries from local GeoJSON
- jsPDF for PDF export

## Customize the district data

- Edit `data/bangladesh.geojson` to change district boundaries and map features.
- Each GeoJSON feature should include a stable `properties.shapeName` value; the map uses it as the district ID.
- Update English and Bengali display names in `BD_DISTRICTS` in `js/data.js`.

## Run

Serve the folder with any static server, for example:

```sh
python -m http.server 8080
```

Then open http://localhost:8080.
