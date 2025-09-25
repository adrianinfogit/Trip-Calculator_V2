document.addEventListener('DOMContentLoaded', function () {
    const $ = id => document.getElementById(id);

    // --- Element Selectors ---
    const inputs = ['tripDistance', 'electricDistance', 'fuelConsumption', 'electricConsumption', 'gasPrice', 'elecPrice'].map($);
    const [tripDistance, electricDistance, fuelConsumption, electricConsumption, gasPrice, elecPrice] = inputs;
    const totalCost = $('totalCost'), costElec = $('costElec'), costGas = $('costGas');
    const litersGas = $('litersGas'), kwhElec = $('kwhElec'), pctElec = $('pctElec'), pctGas = $('pctGas');
    const splitFill = $('splitFill'), warn = $('warn');
    const ORS_API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImRkZjFhMmRiZGI1NjQ1Yjg4NDUwNmQ4ZjkzMDYxNjFmIiwiaCI6Im11cm11cjY0In0=';

    // --- Cost Calculation ---
    function parseNumber(el) { const v = parseFloat(el.value); return Number.isFinite(v) ? v : 0; }
    function fmt(v, currency = false) { return currency ? '€' + v.toFixed(2) : v.toFixed(2); }

    function calculate() {
        let d = parseNumber(tripDistance);
        let dElec = parseNumber(electricDistance);
        const fuelLper100 = parseNumber(fuelConsumption);
        const kmPerKwh = parseNumber(electricConsumption) || 1e-6;
        const priceGas = parseNumber(gasPrice);
        const priceElec = parseNumber(elecPrice);

        if (dElec > d) {
            warn.style.display = 'block';
            warn.textContent = 'Electric distance exceeds trip distance — clamped.';
            dElec = d;
        } else {
            warn.style.display = 'none';
        }
        if (d <= 0) {
            updateDisplay(0, 0, 0, 0, 0, 0);
            return;
        }

        const dGas = Math.max(0, d - dElec);
        const liters = (dGas * fuelLper100) / 100;
        const kwh = dElec / kmPerKwh;
        const cost_gas = liters * priceGas;
        const cost_elec = kwh * priceElec;
        const total = cost_gas + cost_elec;
        const pct_elec = (dElec / d) * 100;
        updateDisplay(total, cost_elec, cost_gas, liters, kwh, pct_elec);
    }

    function updateDisplay(total, cost_e, cost_g, liters, kwh, pct_elec) {
        totalCost.textContent = fmt(total, true);
        costElec.textContent = fmt(cost_e, true);
        costGas.textContent = fmt(cost_g, true);
        litersGas.textContent = fmt(liters) + ' L';
        kwhElec.textContent = fmt(kwh) + ' kWh';
        const pctE = Number.isFinite(pct_elec) ? pct_elec : 0;
        const pctG = 100 - pctE;
        pctElec.textContent = pctE.toFixed(1) + '%';
        pctGas.textContent = pctG.toFixed(1) + '%';
        splitFill.style.width = Math.max(0, Math.min(100, pctE)) + '%';
    }
    inputs.forEach(inp => inp.addEventListener('input', calculate));
    calculate();

    // --- Map & Routing ---
    const map = L.map('map').setView([51.1657, 10.4515], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    let routeLayer, markers = [];

    async function geocode(place) {
        const res = await fetch(`https://api.openrouteservice.org/geocode/search?api_key=${ORS_API_KEY}&text=${encodeURIComponent(place)}`);
        const data = await res.json();
        if (data.features && data.features.length > 0) return data.features[0].geometry.coordinates;
        throw new Error('Location not found: ' + place);
    }

    $('calcRoute').addEventListener('click', async () => {
        const depart = $('depart').value.trim();
        const destination = $('destination').value.trim();
        const stops = [...document.querySelectorAll('.stop-input')].map(i => i.value.trim()).filter(v => v);
        if (!depart || !destination) { alert('Enter both departure and destination'); return; }

        try {
            const allPlaces = [depart, ...stops, destination];
            const coords = await Promise.all(allPlaces.map(geocode));
            const body = { coordinates: coords };

            const resRoute = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
                method: 'POST',
                headers: { 'Authorization': ORS_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const json = await resRoute.json();

            if (routeLayer) map.removeLayer(routeLayer);
            markers.forEach(m => map.removeLayer(m));
            markers = [];

            if (json.features && json.features.length > 0) {
                const route = json.features[0];
                const km = route.properties.summary.distance / 1000;
                tripDistance.value = km.toFixed(1);
                calculate();

                const durationSec = route.properties.summary.duration;
                $('tripTime').textContent = formatDuration(durationSec);

                const coordsLatLng = route.geometry.coordinates.map(c => [c[1], c[0]]);
                routeLayer = L.polyline(coordsLatLng, { color: '#0d6efd', weight: 5 }).addTo(map);
                map.fitBounds(routeLayer.getBounds());
                
                fetchElevationProfile(coordsLatLng, km);

                coords.forEach((c, idx) => {
                    const marker = L.marker([c[1], c[0]], {
                        icon: L.divIcon({
                            className: 'custom-marker',
                            html: `<div style="background:#0d6efd;color:white;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:bold;">${idx + 1}</div>`,
                            iconSize: [28, 28]
                        })
                    }).addTo(map);
                    markers.push(marker);
                });

                const [destLon, destLat] = coords[coords.length - 1];
                fetchWeather(destLat, destLon, destination);
            } else { alert('No route found.'); }
        } catch (err) { console.error(err); alert('Error: ' + err.message); }
    });

    $('googleMapsBtn').addEventListener('click', () => {
        const depart = encodeURIComponent($('depart').value.trim());
        const destination = encodeURIComponent($('destination').value.trim());
        const stops = [...document.querySelectorAll('.stop-input')].map(i => encodeURIComponent(i.value.trim())).filter(v => v);
        if (!depart || !destination) { alert('Enter both departure and destination'); return; }
        const waypoints = stops.join('|');
        const url = `https://www.google.com/maps/dir/?api=1&origin=${depart}&destination=${destination}` + (waypoints ? `&waypoints=${waypoints}` : '');
        window.open(url, '_blank');
    });

    // --- Stops Management ---
    $('addStopBtn').addEventListener('click', () => addStopRow());
    function addStopRow() {
        const stopContainer = document.createElement('div');
        stopContainer.className = 'stop-row';
        stopContainer.draggable = true;
        stopContainer.innerHTML = `
            <div class="drag-handle">☰</div>
            <div class="flex-grow-1 position-relative">
                <input type="text" class="form-control stop-input" placeholder="e.g., Leipzig">
            </div>
            <button type="button" class="btn-close remove-stop"></button>
        `;
        $('stops').appendChild(stopContainer);
        stopContainer.querySelector('.remove-stop').addEventListener('click', () => {
            stopContainer.remove();
            $('calcRoute').click();
        });
        stopContainer.addEventListener('dragstart', () => stopContainer.classList.add('dragging'));
        stopContainer.addEventListener('dragend', () => stopContainer.classList.remove('dragging'));
        setupAutocomplete(stopContainer.querySelector('.stop-input'));
    }

    const stopsContainer = $('stops');
    stopsContainer.addEventListener('dragover', e => {
        e.preventDefault();
        const dragging = document.querySelector('.dragging');
        const afterElement = getDragAfterElement(stopsContainer, e.clientY);
        if (afterElement == null) {
            stopsContainer.appendChild(dragging);
        } else {
            stopsContainer.insertBefore(dragging, afterElement);
        }
    });

    function getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.stop-row:not(.dragging)')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    // --- Weather ---
    async function fetchWeather(lat, lon, placeName) {
        $('weatherTemperature').textContent = 'Loading...';
        $('forecastDays').innerHTML = '';
        $('weatherLink').textContent = '';
        try {
            const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,weathercode&current_weather=true&timezone=auto`);
            const data = await res.json();
            const weatherMap = { 0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️', 45: '🌫️', 48: '🌫️', 51: '🌦️', 53: '🌦️', 55: '🌦️', 61: '🌧️', 63: '🌧️', 65: '🌧️', 71: '🌨️', 73: '🌨️', 75: '🌨️', 80: '🌩️', 81: '🌩️', 82: '🌩️', 95: '⛈️' };
            if (data.current_weather) {
                const weather = data.current_weather;
                $('weatherTemperature').innerHTML = `Now: <strong>${Math.round(weather.temperature)}°C</strong> ${weatherMap[weather.weathercode] || '❓'}`;
            }
            if (data.daily) {
                const forecastDays = $('forecastDays');
                forecastDays.innerHTML = '';
                for (let i = 0; i < 5; i++) {
                    const day = new Date(data.daily.time[i]).toLocaleDateString('en-GB', { weekday: 'short' });
                    const minTemp = Math.round(data.daily.temperature_2m_min[i]);
                    const maxTemp = Math.round(data.daily.temperature_2m_max[i]);
                    forecastDays.innerHTML += `<div class="col forecast-day"><strong>${day}</strong><br>${minTemp}° / ${maxTemp}°C ${weatherMap[data.daily.weathercode[i]] || '❓'}</div>`;
                }
            }
            $('weatherLink').href = `https://www.google.com/search?q=weather+${encodeURIComponent(placeName)}`;
            $('weatherLink').textContent = `Detailed forecast for ${placeName}`;
        } catch (err) {
            console.error(err);
            $('weatherTemperature').textContent = 'Weather data unavailable';
        }
    }
    
    // --- Elevation ---
    let elevationProfileCoords = [], elevationHoverMarker = null;

    async function fetchElevationProfile(coordsLatLng, totalDistanceKm) {
        const maxPoints = 50;
        const step = Math.max(1, Math.floor(coordsLatLng.length / maxPoints));
        const sampled = coordsLatLng.filter((_, i) => i % step === 0);
        if (sampled[sampled.length - 1] !== coordsLatLng[coordsLatLng.length - 1]) {
            sampled.push(coordsLatLng[coordsLatLng.length - 1]);
        }
        elevationProfileCoords = sampled;
        const locations = sampled.map(([lat, lon]) => ({ latitude: lat, longitude: lon }));
        try {
            const res = await fetch('https://api.open-elevation.com/api/v1/lookup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ locations })
            });
            const data = await res.json();
            if(data.results && data.results.length > 1) {
                renderElevationChart(data.results.map(r => r.elevation), totalDistanceKm);
            } else {
                 $('elevationProfile').textContent = 'Elevation data unavailable.';
            }
        } catch {
            $('elevationProfile').textContent = 'Elevation data unavailable.';
        }
    }

    function renderElevationChart(elevations, totalDistanceKm) {
        const container = $('elevationProfile');
        container.innerHTML = '';
        const w = container.clientWidth, h = 100, n = elevations.length;
        const margin = 32, chartW = w - margin - 8, chartH = h - margin;
        const max = Math.max(...elevations), min = Math.min(...elevations);

        let points = '', hoverCircles = '';
        for (let i = 0; i < n; i++) {
            const x = margin + (i / (n - 1)) * chartW;
            const y = chartH - ((elevations[i] - min) / (max - min + 1e-6)) * (chartH - 8);
            points += `${x},${y} `;
            hoverCircles += `<circle class="elev-hover" data-idx="${i}" cx="${x}" cy="${y}" r="8" fill="transparent" />`;
        }

        const svgContent = `
            <svg width="${w}" height="${h}" style="touch-action:none;user-select:none;">
                <defs>
                    <linearGradient id="elevGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" style="stop-color:#0d6efd;stop-opacity:0.4"/>
                        <stop offset="100%" style="stop-color:#0d6efd;stop-opacity:0.05"/>
                    </linearGradient>
                </defs>
                <path d="M${margin},${chartH} L${points} L${margin + chartW},${chartH} Z" fill="url(#elevGradient)"/>
                <path d="M${points.trim().split(' ')[0]} L${points}" fill="none" stroke="#0d6efd" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
                ${hoverCircles}
                <g id="elevation-tooltip" style="visibility: hidden;">
                    <line class="elevation-tooltip-line" y1="8" y2="${chartH}"></line>
                    <rect class="elevation-tooltip-rect" width="50" height="20" y="8"></rect>
                    <text class="elevation-tooltip-text" y="22">0m</text>
                </g>
                <text x="2" y="${chartH}" font-size="11" fill="#6c757d">${min}m</text>
                <text x="2" y="16" font-size="11" fill="#6c757d">${max}m</text>
                <text x="${margin}" y="${h - 4}" font-size="11" text-anchor="middle">0km</text>
                <text x="${margin + chartW}" y="${h - 4}" font-size="11" text-anchor="middle">${Math.round(totalDistanceKm)}km</text>
            </svg>`;
        
        container.innerHTML = `<div style="margin-bottom: 4px;">Elevation Profile</div>${svgContent}`;

        const tooltip = container.querySelector('#elevation-tooltip');
        const tooltipLine = tooltip.querySelector('.elevation-tooltip-line');
        const tooltipRect = tooltip.querySelector('.elevation-tooltip-rect');
        const tooltipText = tooltip.querySelector('.elevation-tooltip-text');

        setTimeout(() => {
            container.querySelectorAll('.elev-hover').forEach(circle => {
                circle.addEventListener('mouseenter', (e) => {
                    const idx = parseInt(e.target.dataset.idx);
                    const x = parseFloat(e.target.getAttribute('cx'));
                    const elevation = Math.round(elevations[idx]);
                    
                    showElevationHoverMarker(idx);

                    tooltipLine.setAttribute('x1', x);
                    tooltipLine.setAttribute('x2', x);
                    tooltipText.setAttribute('x', x);
                    tooltipRect.setAttribute('x', x - 25);
                    tooltipText.textContent = `${elevation}m`;
                    tooltip.style.visibility = 'visible';
                });
            });
            container.addEventListener('mouseleave', () => {
                removeElevationHoverMarker();
                tooltip.style.visibility = 'hidden';
            });
        }, 0);
    }
    
    function showElevationHoverMarker(idx) {
        if (!elevationProfileCoords[idx]) return;
        const [lat, lon] = elevationProfileCoords[idx];
        if (elevationHoverMarker) {
            elevationHoverMarker.setLatLng([lat, lon]);
        } else {
            elevationHoverMarker = L.circleMarker([lat, lon], {
                radius: 8, color: '#f59e0b', fillColor: '#fbbf24', fillOpacity: 0.8, weight: 2
            }).addTo(map);
        }
    }

    function removeElevationHoverMarker() {
        if (elevationHoverMarker) {
            map.removeLayer(elevationHoverMarker);
            elevationHoverMarker = null;
        }
    }

    // --- POI ---
    let poiMap;
    $('showPOIBtn').addEventListener('click', () => {
        const section = $('poiSection');
        const isVisible = section.style.display === 'none';
        section.style.display = isVisible ? 'block' : 'none';
        if (isVisible && !poiMap) {
            poiMap = L.map('poiMap').setView([51.1657, 10.4515], 5);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(poiMap);
        }
    });

    $('searchPOIBtn').addEventListener('click', async () => {
        const poiListContainer = $('poiList');
        poiListContainer.innerHTML = '<div class="text-center"><div class="spinner-border spinner-border-sm" role="status"><span class="visually-hidden">Loading...</span></div> Searching...</div>';
        
        const allPlaces = [$('depart').value.trim(), ...[...document.querySelectorAll('.stop-input')].map(i => i.value.trim()).filter(v => v), $('destination').value.trim()];
        if (allPlaces.length < 2 || !allPlaces[0] || !allPlaces[allPlaces.length - 1]) {
            poiListContainer.textContent = 'Please enter a valid departure and destination.';
            return;
        }

        let coords;
        try {
            coords = await Promise.all(allPlaces.map(geocode));
        } catch (err) {
            poiListContainer.textContent = 'Could not find one of the locations.';
            return;
        }

        const radiusM = (parseFloat($('poiRadius').value) || 5) * 1000;
        const poiCount = parseInt($('poiCount').value) || 10;
        
        if (poiMap) {
            poiMap.eachLayer(l => { if (l instanceof L.Marker) poiMap.removeLayer(l); });
        }

        let html = '';
        let poiMarkers = {};
        let allPOIsFound = false;
        
        // FIX: Define the icon properties here, making it easy to adjust size
        const iconWidth = 42;
        const iconHeight = 56;

        for (let i = 0; i < coords.length; i++) {
            const [lon, lat] = coords[i];
            const query = `[out:json];(node["tourism"="attraction"](around:${radiusM},${lat},${lon});way["tourism"="attraction"](around:${radiusM},${lat},${lon}););out center ${poiCount};`;
            try {
                const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: query });
                const data = await res.json();

                if (data.elements && data.elements.length) {
                    allPOIsFound = true;
                    html += `<h6 class="mt-3">${allPlaces[i]}</h6><div class="list-group">`;
                    data.elements.forEach(poi => {
                        const name = poi.tags?.name || 'Unnamed Attraction';
                        const poiId = `${poi.type}-${poi.id}`;
                        const poiLat = poi.lat || poi.center.lat;
                        const poiLon = poi.lon || poi.center.lon;
                        
                        const gmapsUrl = `https://www.google.com/maps?q=${poiLat},${poiLon}`;

                        html += `
                            <div class="list-group-item list-group-item-action poi-list-item" data-poi-id="${poiId}">
                                <div class="d-flex w-100 justify-content-between">
                                    <h6 class="mb-1">${name}</h6>
                                </div>
                                <div class="poi-links">
                                    <a href="${gmapsUrl}" target="_blank">Google Maps</a>
                                </div>
                            </div>`;
                        
                        if (poiMap) {
                            // FIX: Create the icon using the correct Leaflet API method with size and anchor
                            const marker = L.marker([poiLat, poiLon], {
                                icon: L.divIcon({ 
                                    className: 'poi-marker-icon', 
                                    html: '',
                                    iconSize: [iconWidth, iconHeight],
                                    iconAnchor: [iconWidth / 2, iconHeight] // This is the crucial fix
                                })
                            }).addTo(poiMap).bindPopup(name);
                            poiMarkers[poiId] = marker;
                        }
                    });
                    html += '</div>';
                }
            } catch (err) {
                console.error(`Failed to fetch POIs for ${allPlaces[i]}`, err);
            }
        }

        poiListContainer.innerHTML = allPOIsFound ? html : 'No tourist attractions found near your stops.';
        
        if (poiMap) {
            poiMap.fitBounds(coords.map(c => [c[1], c[0]]));
        }

        document.querySelectorAll('.poi-list-item').forEach(item => {
            const poiId = item.dataset.poiId;
            const marker = poiMarkers[poiId];
            if (!marker) return;

            item.addEventListener('mouseenter', () => {
                marker._icon.classList.add('poi-marker-highlight');
            });
            item.addEventListener('mouseleave', () => {
                marker._icon.classList.remove('poi-marker-highlight');
            });
        });
    });

    // --- Autocomplete ---
    function setupAutocomplete(input) {
        let timer, dropdown;
        input.addEventListener('input', () => {
            clearTimeout(timer);
            const existingDropdown = input.parentNode.querySelector('.autocomplete-dropdown');
            if(existingDropdown) existingDropdown.remove();
            
            if (input.value.length < 3) return;

            timer = setTimeout(async () => {
                try {
                    const res = await fetch(`https://api.openrouteservice.org/geocode/autocomplete?api_key=${ORS_API_KEY}&text=${encodeURIComponent(input.value)}`);
                    if (!res.ok) throw new Error('API request failed');
                    const data = await res.json();

                    if (!data.features?.length) return;
                    
                    const oldDropdown = input.parentNode.querySelector('.autocomplete-dropdown');
                    if(oldDropdown) oldDropdown.remove();

                    dropdown = document.createElement('div');
                    dropdown.className = 'autocomplete-dropdown';
                    data.features.forEach(f => {
                        const item = document.createElement('div');
                        item.textContent = f.properties.label;
                        item.addEventListener('mousedown', () => {
                            input.value = f.properties.label;
                            if (dropdown) {
                                dropdown.remove();
                                dropdown = null;
                            }
                            setTimeout(() => {
                                const departValue = $('depart').value.trim();
                                const destValue = $('destination').value.trim();
                                if (departValue && destValue) {
                                    $('calcRoute').click();
                                }
                            }, 100);
                        });
                        dropdown.appendChild(item);
                    });
                    input.parentNode.appendChild(dropdown);
                    const rect = input.getBoundingClientRect();
                    dropdown.style.left = `${input.offsetLeft}px`;
                    dropdown.style.top = `${input.offsetTop + rect.height}px`;
                    dropdown.style.width = `${rect.width}px`;
                } catch (error) {
                    console.error("Autocomplete failed:", error);
                }
            }, 300);
        });
        input.addEventListener('blur', () => setTimeout(() => {
            const currentDropdown = input.parentNode.querySelector('.autocomplete-dropdown');
            if (currentDropdown) {
                currentDropdown.remove();
            }
        }, 150));
    }
    setupAutocomplete($('depart'));
    setupAutocomplete($('destination'));
    
    // --- Helpers ---
    function formatDuration(sec) {
        const h = Math.floor(sec / 3600);
        const m = Math.round((sec % 3600) / 60);
        return `${h}h ${m.toString().padStart(2, '0')}m`;
    }
});