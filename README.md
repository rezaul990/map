# Map - Travel Map Site

A travel map site like [unseenbangladesh.com](https://unseenbangladesh.com/) - mark the places you've visited and download your travel map.

## Features

- Bangladesh map - 64 districts with click-to-toggle
- World map - 179+ countries with click-to-toggle
- 9 color themes
- Export to PNG, JPG, PDF
- Search, select all, clear
- Custom name & image upload
- Auto-save (localStorage)
- Progress bar
- Copy travel data

## Tech

- Vanilla HTML/CSS/JS - no framework
- Pure SVG map rendering - no external map service, no API key
- Local GeoJSON data files
- jsPDF for PDF export only

## Run

Serve the folder with any static server, e.g.:

```sh
python -m http.server 8080
```

Then open http://localhost:8080
