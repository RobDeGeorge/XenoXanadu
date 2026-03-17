/**
 * Leaflet map helper functions.
 * Must be called only in browser context (onMount).
 */

export function darkTiles(L, map) {
  return L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 18
  }).addTo(map);
}

export function circleIcon(L, color, label) {
  return L.divIcon({
    className: '',
    html: '<div style="width:26px;height:26px;border-radius:50%;background:' + color +
      ';border:2px solid #f4efe1;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;color:#141310;font-family:Outfit,-apple-system,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,0.4);">' +
      label + '</div>',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -15]
  });
}

export function parkIcon(L, color, size) {
  size = size || 14;
  return L.divIcon({
    className: '',
    html: '<div style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:' + color +
      ';border:2px solid rgba(244,239,225,0.7);box-shadow:0 1px 6px rgba(0,0,0,0.3);"></div>',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 4)]
  });
}

export function stopPopup(prefix, n, name, info, pos, color) {
  var gurl = 'https://www.google.com/maps/search/?api=1&query=' + pos[0] + ',' + pos[1];
  return '<div style="font-family:Outfit,-apple-system,sans-serif;">' +
    '<strong style="font-size:14px;' + (color ? 'color:' + color + ';' : '') + '">' + prefix + n + ': ' + name + '</strong><br>' +
    '<span style="font-size:12px;color:#666;line-height:1.6;">' + info + '</span><br>' +
    '<a href="' + gurl + '" target="_blank" style="display:inline-block;margin-top:6px;padding:4px 12px;background:#c45d3e;color:#f4efe1;border-radius:2px;font-family:Outfit,-apple-system,sans-serif;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;text-decoration:none;">Directions \u2192</a>' +
    '</div>';
}

export function parkPopup(park) {
  var isComplete = park.status === 'complete';
  var link = isComplete
    ? '<a href="/parks/' + park.slug + '" style="display:inline-block;margin-top:8px;padding:5px 14px;background:#c45d3e;color:#f4efe1;border-radius:2px;font-family:Outfit,-apple-system,sans-serif;font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;text-decoration:none;">Explore Guide \u2192</a>'
    : '<span style="display:inline-block;margin-top:8px;padding:5px 14px;background:#252219;color:#7a7362;border:1px solid #3a3628;border-radius:2px;font-family:Outfit,-apple-system,sans-serif;font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">Coming Soon</span>';
  return '<div style="font-family:Outfit,-apple-system,sans-serif;min-width:180px;">' +
    '<strong style="font-size:15px;color:' + (isComplete ? '#c45d3e' : '#b0a990') + ';">' + park.name + '</strong><br>' +
    '<span style="font-size:12px;color:#7a7362;">' + park.state + '</span><br>' +
    link +
    '</div>';
}

export function addShuttleRoute(L, map, stops, coords, color, prefix, dashed) {
  var dashArray = dashed ? '8, 6' : null;
  L.polyline(coords, {
    color: color,
    weight: 4,
    opacity: dashed ? 0.65 : 0.75,
    dashArray: dashArray,
    smoothFactor: 1.5
  }).addTo(map);

  stops.forEach(function(s) {
    L.marker(s.pos, { icon: circleIcon(L, color, s.n) })
      .addTo(map)
      .bindPopup(stopPopup(prefix, s.n, s.name, s.info, s.pos, dashed ? color : null), { maxWidth: 240 });
  });
}

export function createMap(L, elementId, options) {
  options = options || {};
  var map = L.map(elementId, {
    center: options.center || [39.8283, -98.5795],
    zoom: options.zoom || 4,
    zoomControl: options.zoomControl !== false,
    attributionControl: options.attributionControl !== false
  });
  darkTiles(L, map);
  return map;
}
