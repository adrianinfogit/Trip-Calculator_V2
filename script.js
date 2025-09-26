document.addEventListener('DOMContentLoaded', function () {
    const $ = id => document.getElementById(id);

    // --- Element Selectors ---
    const inputs = ['tripDistance', 'electricDistance', 'fuelConsumption', 'electricConsumption', 'gasPrice', 'elecPrice'].map($);
    const [tripDistance, electricDistance, fuelConsumption, electricConsumption, gasPrice, elecPrice] = inputs;
    const totalCost = $('totalCost'), costElec = $('costElec'), costGas = $('costGas');
    const litersGas = $('litersGas'), kwhElec = $('kwhElec'), pctElec = $('pctElec'), pctGas = $('pctGas');
    const costPerKm = $('costPerKm'), savings = $('savings'), summaryText = $('summaryText'), roundTripCost = $('roundTripCost');
    const splitFill = $('splitFill'), warn = $('warn');
    const locationsContainer = $('locationsContainer');
    // --- FIX: Restored the original, working API Key ---
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
            updateDisplay({ total: 0, cost_e: 0, cost_g: 0, liters: 0, kwh: 0, pct_elec: 0, cost_per_km: 0, saved: 0, dist: 0, round_trip: 0 });
            return;
        }

        const dGas = Math.max(0, d - dElec);
        const liters = (dGas * fuelLper100) / 100;
        const kwh = dElec / kmPerKwh;
        const cost_gas = liters * priceGas;
        const cost_elec = kwh * priceElec;
        const total = cost_gas + cost_elec;
        const pct_elec = (dElec / d) * 100;

        const cost_gas_only = (d * fuelLper100 / 100) * priceGas;
        const saved = cost_gas_only - total;
        const cost_per_km = total / d;
        const round_trip = total * 2;

        updateDisplay({ total, cost_e: cost_elec, cost_g: cost_gas, liters, kwh, pct_elec, cost_per_km, saved, dist: d, round_trip });
    }

    function updateDisplay(data) {
        totalCost.textContent = fmt(data.total, true);
        costElec.textContent = fmt(data.cost_e, true);
        costGas.textContent = fmt(data.cost_g, true);
        litersGas.textContent = fmt(data.liters) + ' L';
        kwhElec.textContent = fmt(data.kwh) + ' kWh';
        costPerKm.textContent = fmt(data.cost_per_km, true);
        savings.textContent = fmt(data.saved, true);
        roundTripCost.textContent = fmt(data.round_trip, true);

        const pctE = Number.isFinite(data.pct_elec) ? data.pct_elec : 0;
        const pctG = 100 - pctE;
        pctElec.textContent = pctE.toFixed(1) + '%';
        pctGas.textContent = pctG.toFixed(1) + '%';
        splitFill.style.width = Math.max(0, Math.min(100, pctE)) + '%';

        if (data.dist > 0) {
            summaryText.textContent = `Your ${Math.round(data.dist)} km trip will cost approx. ${fmt(data.total, true)}, saving you ${fmt(data.saved, true)} compared to a gasoline-only trip.`;
        } else {
            summaryText.textContent = '';
        }
    }
    inputs.forEach(inp => inp.addEventListener('input', calculate));
    calculate();

    // --- Map & Routing ---
    const map = L.map('map').setView([51.1657, 10.4515], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    let routeLayers = [], markers = [], poiLayer = L.layerGroup().addTo(map);

    async function geocode(place) {
        const res = await fetch(`https://api.openrouteservice.org/geocode/search?api_key=${ORS_API_KEY}&text=${encodeURIComponent(place)}`);
        const data = await res.json();
        if (data.features && data.features.length > 0) return data.features[0].geometry.coordinates;
        throw new Error('Location not found: ' + place);
    }

    async function calculateAndDisplayRoute() {
        const calcButton = $('calcRoute');
        calcButton.disabled = true;
        calcButton.textContent = 'Calculating...';

        const locationInputs = locationsContainer.querySelectorAll('.location-input');
        const allPlaces = Array.from(locationInputs).map(input => input.value.trim());
        const validPlaces = allPlaces.filter(p => p);

        if (validPlaces.length < 2) {
            alert('Enter at least a departure and a destination');
            calcButton.disabled = false;
            calcButton.textContent = 'Calculate Route';
            return;
        }
        
        routeLayers.forEach(l => map.removeLayer(l));
        routeLayers = [];
        markers.forEach(m => map.removeLayer(m));
        markers = [];
        $('alternativeRoutesInfo').innerHTML = '';
        poiLayer.clearLayers();
        $('poiList').innerHTML = '';
        $('elevationProfile').innerHTML = '';
        $('elevationStats').innerHTML = '';
        $('elevationImpact').innerHTML = '';

        try {
            const coords = await Promise.all(validPlaces.map(geocode));
            
            const profile = $('profile').value;
            const preference = $('preference').value;
            const avoidFeatures = [...document.querySelectorAll('.avoid-feature:checked')].map(cb => cb.value);

            const body = {
                coordinates: coords,
                preference: preference,
                instructions: false
            };
            
            const directDistance = haversineDistance(coords[0], coords[coords.length - 1]);
            const LONG_ROUTE_THRESHOLD_KM = 150; 
            if (coords.length === 2 && directDistance < LONG_ROUTE_THRESHOLD_KM) {
                body.alternative_routes = { target_count: 3 };
            }

            if (avoidFeatures.length > 0) {
                body.options = { avoid_features: avoidFeatures };
            }

            const resRoute = await fetch(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`, {
                method: 'POST',
                headers: { 'Authorization': ORS_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const json = await resRoute.json();
            
            if (json.error) {
                const errorMessage = json.error.message.includes('waypoints > 2') 
                    ? "Alternative routes are not supported when using stops."
                    : json.error.message;
                throw new Error(errorMessage || 'An unknown routing error occurred.');
            }

            if (json.features && json.features.length > 0) {
                const routeFeatures = json.features;
                let combinedBounds = L.latLngBounds();

                routeFeatures.forEach((feature, index) => {
                    const isPrimary = index === 0;
                    const coordsLatLng = feature.geometry.coordinates.map(c => [c[1], c[0]]);
                    const polyline = L.polyline(coordsLatLng, {
                        color: isPrimary ? '#0d6efd' : '#6c757d',
                        weight: isPrimary ? 6 : 5,
                        opacity: isPrimary ? 1.0 : 0.7,
                        className: 'route-polyline'
                    }).addTo(map);

                    polyline.featureData = feature;
                    routeLayers.push(polyline);
                    combinedBounds.extend(polyline.getBounds());
                    
                    polyline.on('click', () => selectRoute(feature));
                });
                
                map.fitBounds(combinedBounds.pad(0.1));
                
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

                selectRoute(routeFeatures[0]);
                displayAlternativeRoutes(routeFeatures);
                
                const [destLon, destLat] = coords[coords.length - 1];
                fetchWeather(destLat, destLon, validPlaces[validPlaces.length - 1]);
            } else { 
                alert('No route found. Please check if the locations are valid and accessible.'); 
            }
        } catch (err) { 
            console.error(err); 
            alert('Error: ' + err.message); 
        } finally {
            calcButton.disabled = false;
            calcButton.textContent = 'Calculate Route';
        }
    }

    $('calcRoute').addEventListener('click', calculateAndDisplayRoute);
    
    function selectRoute(feature) {
        const km = feature.properties.summary.distance / 1000;
        tripDistance.value = km.toFixed(1);
        calculate();

        const durationSec = feature.properties.summary.duration;
        $('tripTime').textContent = formatDuration(durationSec);

        const coordsLatLng = feature.geometry.coordinates.map(c => [c[1], c[0]]);
        fetchElevationProfile(coordsLatLng, km);
        
        routeLayers.forEach(layer => {
            const isSelected = layer.featureData.properties.summary.distance === feature.properties.summary.distance;
            layer.setStyle({
                color: isSelected ? '#0d6efd' : '#6c757d',
                weight: isSelected ? 6 : 5,
                opacity: isSelected ? 1.0 : 0.7
            });
            if (isSelected) {
                layer.bringToFront();
            }
        });
        
        const infoItems = document.querySelectorAll('#alternativeRoutesInfo .list-group-item');
        infoItems.forEach((item, index) => {
            if (routeLayers[index] && routeLayers[index].featureData.properties.summary.distance === feature.properties.summary.distance) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }

    function displayAlternativeRoutes(features) {
        const container = $('alternativeRoutesInfo');
        if (features.length <= 1) {
            container.innerHTML = '';
            return;
        }

        let html = '<h6 class="text-muted">Alternative Routes</h6><div class="list-group">';
        features.forEach((feature, index) => {
            const summary = feature.properties.summary;
            const distance = (summary.distance / 1000).toFixed(1);
            const duration = formatDuration(summary.duration);
            const isActive = index === 0;
            html += `
                <a href="#" class="list-group-item list-group-item-action ${isActive ? 'active' : ''}" data-route-index="${index}">
                    <div class="d-flex w-100 justify-content-between">
                        <h6 class="mb-1">Route ${index + 1} ${isActive ? '<small class="fw-normal">(Recommended)</small>' : ''}</h6>
                    </div>
                    <p class="mb-0"><strong>${distance} km</strong> / ${duration}</p>
                </a>`;
        });
        html += '</div>';
        container.innerHTML = html;
        
        container.querySelectorAll('.list-group-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const index = parseInt(item.dataset.routeIndex);
                selectRoute(features[index]);
            });
        });
    }

    $('googleMapsBtn').addEventListener('click', () => {
        const allPlaces = Array.from(locationsContainer.querySelectorAll('.location-input'))
            .map(i => i.value.trim())
            .filter(Boolean);

        if (allPlaces.length < 2) {
            alert('Enter at least a departure and destination');
            return;
        }

        const origin = encodeURIComponent(allPlaces[0]);
        const destination = encodeURIComponent(allPlaces[allPlaces.length - 1]);
        const waypoints = allPlaces.slice(1, -1).map(p => encodeURIComponent(p)).join('|');
        
        const url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}` + (waypoints ? `&waypoints=${waypoints}` : '');
        window.open(url, '_blank');
    });

    // --- Location Management ---
    function createLocationRow(value = '') {
        const row = document.createElement('div');
        row.className = 'location-row';
        row.draggable = true;
    
        row.innerHTML = `
            <div class="drag-handle">☰</div>
            <div class="flex-grow-1 position-relative">
                <input type="text" class="form-control location-input" value="${value}">
            </div>
        `;
    
        row.addEventListener('dragstart', () => row.classList.add('dragging'));
        row.addEventListener('dragend', () => {
            row.classList.remove('dragging');
            updateLocationRoles();
            calculateAndDisplayRoute();
        });
    
        setupAutocomplete(row.querySelector('.location-input'));
        return row;
    }

    function addStopRow() {
        const allRows = locationsContainer.querySelectorAll('.location-row');
        const newStop = createLocationRow('');
        locationsContainer.insertBefore(newStop, allRows[allRows.length - 1]);
        updateLocationRoles();
    }
    
    function updateLocationRoles() {
        const rows = locationsContainer.querySelectorAll('.location-row');
        rows.forEach((row, index) => {
            const input = row.querySelector('.location-input');
            const isStop = index > 0 && index < rows.length - 1;

            if (index === 0) {
                input.placeholder = 'Departure';
            } else if (index === rows.length - 1) {
                input.placeholder = 'Destination';
            } else {
                input.placeholder = `Stop ${index}`;
            }

            let removeBtn = row.querySelector('.remove-stop');
            if (isStop && !removeBtn) {
                const newBtn = document.createElement('button');
                newBtn.type = 'button';
                newBtn.className = 'btn-close remove-stop';
                newBtn.setAttribute('aria-label', 'Remove Stop');
                newBtn.addEventListener('click', () => {
                    row.remove();
                    updateLocationRoles();
                    calculateAndDisplayRoute();
                });
                row.appendChild(newBtn);
            } else if (!isStop && removeBtn) {
                removeBtn.remove();
            }
        });
    }

    function initializeLocations() {
        const departure = createLocationRow('Leverkuser Straße 25, Frankfurt, HE, Germany');
        const destination = createLocationRow('');
        locationsContainer.appendChild(departure);
        locationsContainer.appendChild(destination);
        updateLocationRoles();
    }

    $('addStopBtn').addEventListener('click', addStopRow);
    
    $('reverseTripBtn').addEventListener('click', () => {
        const inputs = locationsContainer.querySelectorAll('.location-input');
        if (inputs.length < 2) return;
        const firstVal = inputs[0].value;
        const lastVal = inputs[inputs.length - 1].value;
        inputs[0].value = lastVal;
        inputs[inputs.length - 1].value = firstVal;
        calculateAndDisplayRoute();
    });

    locationsContainer.addEventListener('dragover', e => {
        e.preventDefault();
        const dragging = document.querySelector('.dragging');
        if (!dragging) return;
        const afterElement = getDragAfterElement(locationsContainer, e.clientY);
        if (afterElement == null) {
            locationsContainer.appendChild(dragging);
        } else {
            locationsContainer.insertBefore(dragging, afterElement);
        }
    });

    function getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.location-row:not(.dragging)')];
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
        $('weatherSummary').textContent = 'Loading...';
        $('weatherToday').innerHTML = '';
        $('forecastDays').innerHTML = '';
        $('weatherLink').textContent = '';
        try {
            const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_sum,precipitation_probability_max,windspeed_10m_max,sunrise,sunset&current_weather=true&timezone=auto`);
            const data = await res.json();
            
            if (data.error) {
                throw new Error(data.reason);
            }

            const weatherCodes = { 0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Depositing rime fog', 51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle', 61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain', 71: 'Slight snow fall', 73: 'Moderate snow fall', 75: 'Heavy snow fall', 80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers', 95: 'Thunderstorm' };
            const weatherIcons = { 0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️', 45: '🌫️', 48: '🌫️', 51: '🌦️', 53: '🌦️', 55: '🌦️', 61: '🌧️', 63: '🌧️', 65: '🌧️', 71: '🌨️', 73: '🌨️', 75: '🌨️', 80: '🌩️', 81: '🌩️', 82: '🌩️', 95: '⛈️' };
            
            const today = data.daily;
            const current = data.current_weather;
            const todayCode = current.weathercode;
            
            $('weatherSummary').textContent = `${weatherCodes[todayCode] || 'Weather'} expected in ${placeName}.`;
            
            const formatTime = (iso) => new Date(iso).toLocaleTimeString(navigator.language, { hour: '2-digit', minute: '2-digit' });

            $('weatherToday').innerHTML = `
                <div class="weather-today-main">
                    <div>
                        <div class="temp">${Math.round(current.temperature)}°C</div>
                        <div>Feels like ${Math.round(today.apparent_temperature_max[0])}°C</div>
                    </div>
                    <div class="icon">${weatherIcons[todayCode] || '❓'}</div>
                </div>
                <div class="weather-details">
                    <div class="weather-detail-item" title="Max/Min Temp">
                        <span>🌡️</span>
                        <span>${Math.round(today.temperature_2m_max[0])}° / ${Math.round(today.temperature_2m_min[0])}°</span>
                    </div>
                    <div class="weather-detail-item" title="Precipitation">
                        <span>💧</span>
                        <span>${today.precipitation_probability_max[0]}% (${today.precipitation_sum[0].toFixed(1)}mm)</span>
                    </div>
                    <div class="weather-detail-item" title="Wind Speed">
                        <span>💨</span>
                        <span>${Math.round(today.windspeed_10m_max[0])} km/h</span>
                    </div>
                    <div class="weather-detail-item" title="Sunrise/Sunset">
                        <span>☀️</span>
                        <span>${formatTime(today.sunrise[0])} / ${formatTime(today.sunset[0])}</span>
                    </div>
                </div>
            `;
            
            const forecastContainer = $('forecastDays');
            forecastContainer.innerHTML = '';
            for (let i = 1; i < 5; i++) {
                const day = new Date(today.time[i]).toLocaleDateString('en-GB', { weekday: 'short' });
                const code = today.weathercode[i];
                let rainInfo = '';
                if (today.precipitation_probability_max[i] > 15) {
                    rainInfo = `<div class="rain-info">💧 ${today.precipitation_probability_max[i]}% (${today.precipitation_sum[i].toFixed(1)}mm)</div>`;
                }
                
                forecastContainer.innerHTML += `
                    <div class="col forecast-day">
                        <div><strong>${day}</strong></div>
                        <div class="fs-4">${weatherIcons[code] || '❓'}</div>
                        <div>${Math.round(today.temperature_2m_max[i])}° / ${Math.round(today.temperature_2m_min[i])}°</div>
                        ${rainInfo || '<div>&nbsp;</div>'}
                    </div>
                `;
            }

            $('weatherLink').href = `https://www.google.com/search?q=wetteronline.de+${encodeURIComponent(placeName)}`;
            $('weatherLink').textContent = `Detailed hourly forecast for ${placeName}`;
        } catch (err) {
            console.error(err);
            $('weatherSummary').textContent = 'Weather data unavailable';
        }
    }

    
    // --- Elevation ---
    let elevationProfileCoords = [], elevationHoverMarker = null;

    async function fetchElevationProfile(coordsLatLng, totalDistanceKm) {
        $('elevationProfile').innerHTML = '<div class="text-center text-muted">Loading elevation...</div>';
        $('elevationStats').innerHTML = '';
        $('elevationImpact').innerHTML = '';

        const maxPoints = 100;
        const step = Math.max(1, Math.floor(coordsLatLng.length / maxPoints));
        const sampled = coordsLatLng.filter((_, i) => i % step === 0);
        if (coordsLatLng.length > 1 && sampled[sampled.length - 1] !== coordsLatLng[coordsLatLng.length - 1]) {
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
                 $('elevationProfile').innerHTML = '<div class="text-center text-muted">Elevation data unavailable.</div>';
            }
        } catch {
            $('elevationProfile').innerHTML = '<div class="text-center text-muted">Elevation data unavailable.</div>';
        }
    }

    function calculateElevationImpact(totalAscent, totalDescent, totalDistanceKm) {
        if (totalDistanceKm < 1 || totalAscent < 20) {
            return {
                level: 'Relatively Flat',
                change: 'none',
                gas: '0-2%',
                elec: '0-2%',
                reason: 'This route is relatively flat, so elevation will have minimal impact on consumption.'
            };
        }
    
        const netElevationChange = totalAscent - totalDescent;
        const grossClimbRate = totalAscent / totalDistanceKm; // m/km
        const netClimbRate = netElevationChange / totalDistanceKm; // m/km, positive is uphill
    
        const IS_ROUND_TRIP_LIKE = Math.abs(netElevationChange) < (totalAscent * 0.15); // Net change is less than 15% of total climb
    
        // --- Case 1: Round Trip or Balanced Rolling Hills ---
        if (IS_ROUND_TRIP_LIKE) {
            const reason = 'This is a balanced or round trip. Energy used for climbing is not fully recovered during descents, leading to higher consumption.';
            if (grossClimbRate > 30) { // Very Hilly (e.g., > 3000m climb over 100km)
                return { level: 'Very Hilly', change: 'increase', gas: '15-25%', elec: '10-20%', reason };
            }
            if (grossClimbRate > 15) { // Moderately Hilly
                return { level: 'Rolling Hills', change: 'increase', gas: '8-15%', elec: '5-12%', reason };
            }
            // Gentle Hills
            return { level: 'Gentle Hills', change: 'increase', gas: '3-8%', elec: '2-6%', reason };
        }
    
        // --- Case 2: One-Way Primarily Uphill Trip ---
        if (netClimbRate > 5) { // Net climb of >5m per km
            const reason = 'This route has a significant net climb, requiring much more energy to overcome gravity. Note: your return trip would be very efficient.';
            if (netClimbRate > 25) { // Very Steep Uphill
                return { level: 'Steep Uphill', change: 'increase', gas: '30%+', elec: '25%+', reason };
            }
            if (netClimbRate > 10) { // Moderate Uphill
                return { level: 'Moderate Uphill', change: 'increase', gas: '15-30%', elec: '12-25%', reason };
            }
             // Gentle Uphill
            return { level: 'Gentle Uphill', change: 'increase', gas: '5-15%', elec: '5-12%', reason };
        }
    
        // --- Case 3: One-Way Primarily Downhill Trip ---
        if (netClimbRate < -5) { // Net descent of >5m per km
            const reason = 'This route is primarily downhill. A PHEV can recover significant energy via regenerative braking. Note: your return trip would use much more energy.';
            if (netClimbRate < -25) { // Very Steep Downhill
                return { level: 'Steep Descent', change: 'decrease', gas: '15-25%', elec: '30-60%+', reason };
            }
            if (netClimbRate < -10) { // Moderate Downhill
                return { level: 'Moderate Descent', change: 'decrease', gas: '10-20%', elec: '15-30%', reason };
            }
             // Gentle Downhill
            return { level: 'Gentle Descent', change: 'decrease', gas: '5-10%', elec: '5-15%', reason };
        }
        
        // --- Fallback for minor inclines/declines ---
        if (netClimbRate > 0) { // Slight net uphill
            return {
                level: 'Slightly Uphill',
                change: 'increase',
                gas: '2-5%',
                elec: '1-4%',
                reason: 'The route has a minor net incline, which will slightly increase overall consumption.'
            };
        } else { // Slight net downhill
             return {
                level: 'Slightly Downhill',
                change: 'decrease',
                gas: '1-4%',
                elec: '2-6%',
                reason: 'The route has a minor net descent, allowing for some energy savings through coasting and regeneration.'
            };
        }
    }


    function renderElevationChart(elevations, totalDistanceKm) {
        const container = $('elevationProfile');
        container.innerHTML = '';
        if (!container.clientWidth) {
            setTimeout(() => renderElevationChart(elevations, totalDistanceKm), 100);
            return;
        }

        // --- 1. Calculate Statistics ---
        let totalAscent = 0, totalDescent = 0, maxGrade = 0;
        const segmentDistanceKm = totalDistanceKm / (elevations.length - 1);

        for (let i = 1; i < elevations.length; i++) {
            const elevChange = elevations[i] - elevations[i-1];
            if (elevChange > 0) {
                totalAscent += elevChange;
            } else {
                totalDescent -= elevChange;
            }
            if (segmentDistanceKm > 0) {
                const grade = (elevChange / (segmentDistanceKm * 1000)) * 100;
                if (grade > maxGrade) {
                    maxGrade = grade;
                }
            }
        }

        // --- 2. Render Statistics & Impact Suggestion ---
        $('elevationStats').innerHTML = `
            <div class="elevation-stat-item">
                <div class="label"><i class="bi bi-arrow-up"></i> Ascent</div>
                <div class="value">${Math.round(totalAscent)} m</div>
            </div>
            <div class="elevation-stat-item">
                <div class="label"><i class="bi bi-arrow-down"></i> Descent</div>
                <div class="value">${Math.round(totalDescent)} m</div>
            </div>
             <div class="elevation-stat-item">
                <div class="label"><i class="bi bi-reception-4"></i> Max Grade</div>
                <div class="value">${maxGrade.toFixed(1)}%</div>
            </div>
        `;
        
        const impact = calculateElevationImpact(totalAscent, totalDescent, totalDistanceKm);
        
        const alertType = impact.change === 'increase' ? 'info' : (impact.change === 'decrease' ? 'success' : 'secondary');
        const iconType = impact.change === 'increase' ? 'info-circle-fill' : (impact.change === 'decrease' ? 'check-circle-fill' : 'lightbulb');
        
        let suggestionHtml = '';
        if (impact.change !== 'none') {
            suggestionHtml = `
                <div class="mt-1">Suggested consumption adjustment for a more accurate cost:</div>
                <ul class="mb-0 mt-1">
                    <li><b>Gasoline:</b> ~${impact.gas} ${impact.change}</li>
                    <li><b>Electric:</b> ~${impact.elec} ${impact.change}</li>
                </ul>
            `;
        }

        $('elevationImpact').innerHTML = `
            <div class="alert alert-${alertType} elevation-impact-suggestion">
                <i class="bi bi-${iconType}"></i>
                <div>
                    <strong>Elevation Impact: ${impact.level}.</strong> ${impact.reason}
                    ${suggestionHtml}
                </div>
            </div>
        `;
        
        // --- 3. Render Chart SVG ---
        const w = container.clientWidth, h = 120, n = elevations.length;
        const margin = 32, chartW = w - margin - 8, chartH = h - margin;
        const max = Math.max(...elevations), min = Math.min(...elevations);

        let points = '', hoverCircles = '', gridLines = '';
        const yRange = max - min;
        
        for (let i = 0; i <= 4; i++) {
            const y = chartH - (i/4) * (chartH - 8);
            gridLines += `<line class="elevation-grid-line" x1="${margin}" y1="${y}" x2="${margin+chartW}" y2="${y}"></line>`;
        }

        for (let i = 0; i < n; i++) {
            const x = margin + (i / (n - 1)) * chartW;
            const y = chartH - ((elevations[i] - min) / (yRange + 1e-6)) * (chartH - 8);
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
                ${gridLines}
                <path d="M${margin},${chartH} L${points} L${margin + chartW},${chartH} Z" fill="url(#elevGradient)"/>
                <path d="M${points.trim().split(' ')[0]} L${points}" fill="none" stroke="#0d6efd" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
                ${hoverCircles}
                <g id="elevation-tooltip" style="visibility: hidden;">
                    <line class="elevation-tooltip-line" y1="8" y2="${chartH}"></line>
                    <rect class="elevation-tooltip-rect" width="90" height="20" y="8"></rect>
                    <text class="elevation-tooltip-text" y="22">0m / 0km</text>
                </g>
                <text x="2" y="${chartH}" font-size="11" fill="#6c757d">${Math.round(min)} m</text>
                <text x="2" y="16" font-size="11" fill="#6c757d">${Math.round(max)} m</text>
                <text x="${margin}" y="${h - 4}" font-size="11" text-anchor="middle">0 km</text>
                <text x="${margin + chartW}" y="${h - 4}" font-size="11" text-anchor="middle">${Math.round(totalDistanceKm)} km</text>
            </svg>`;
        
        container.innerHTML = `<div style="margin-bottom: 4px;">Elevation Profile</div>${svgContent}`;

        // --- 4. Setup Tooltip Interactivity ---
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
                    const distance = (idx / (n - 1)) * totalDistanceKm;
                    
                    showElevationHoverMarker(idx);

                    tooltipLine.setAttribute('x1', x);
                    tooltipLine.setAttribute('x2', x);
                    tooltipText.setAttribute('x', x);
                    tooltipRect.setAttribute('x', x - 45);
                    tooltipText.textContent = `${elevation} m / ${distance.toFixed(1)} km`;
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
    $('showPOIBtn').addEventListener('click', () => {
        const section = $('poiSection');
        const isVisible = section.style.display === 'none';
        section.style.display = isVisible ? 'block' : 'none';
        if (!isVisible) {
            poiLayer.clearLayers();
            $('poiList').innerHTML = '';
        }
    });

    $('searchPOIBtn').addEventListener('click', async () => {
        const poiListContainer = $('poiList');
        poiListContainer.innerHTML = '<div class="text-center"><div class="spinner-border spinner-border-sm" role="status"><span class="visually-hidden">Loading...</span></div> Searching...</div>';
        
        poiLayer.clearLayers();
        const allPlaces = Array.from(locationsContainer.querySelectorAll('.location-input'))
            .map(i => i.value.trim())
            .filter(Boolean);

        if (allPlaces.length === 0) {
            poiListContainer.textContent = 'Please enter some locations first.';
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
        const poiCount = parseInt($('poiCount').value) || 5;
        const selectedCategories = [...document.querySelectorAll('.poi-category:checked')].map(cb => cb.value);
        if (selectedCategories.length === 0) {
            poiListContainer.textContent = 'Please select at least one category.';
            return;
        }

        const categoryQueries = {
            museum: '[tourism=museum]',
            historic: '[historic]',
            viewpoint: '[tourism=viewpoint]',
            park: '[leisure=park]'
        };
        const overpassQueryParts = selectedCategories.map(cat => `node${categoryQueries[cat]}(around:{{radius}},{{lat}},{{lon}});way${categoryQueries[cat]}(around:{{radius}},{{lat}},{{lon}});`);
        const queryTemplate = `[out:json];( ${overpassQueryParts.join('')} );out center {{limit}};`;

        let html = '';
        let poiMarkers = {};
        let allPOIsFound = false;
        
        const categoryColors = { museum: '#6f42c1', historic: '#d63384', viewpoint: '#fd7e14', park: '#198754' };

        for (let i = 0; i < coords.length; i++) {
            const [lon, lat] = coords[i];
            const finalQuery = queryTemplate.replace(/\{\{lat\}\}/g, lat).replace(/\{\{lon\}\}/g, lon).replace(/\{\{radius\}\}/g, radiusM).replace(/\{\{limit\}\}/g, poiCount);
            try {
                const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: finalQuery });
                const data = await res.json();

                if (data.elements && data.elements.length) {
                    allPOIsFound = true;
                    html += `<h6 class="mt-3 text-muted">Near ${allPlaces[i]}</h6><div class="list-group list-group-flush">`;
                    
                    data.elements.forEach(poi => {
                        const name = poi.tags?.name || 'Unnamed Attraction';
                        const poiId = `${poi.type}-${poi.id}`;
                        if(poiMarkers[poiId]) return;

                        const poiLat = poi.lat || poi.center.lat;
                        const poiLon = poi.lon || poi.center.lon;
                        
                        const category = selectedCategories.find(cat => {
                            const tags = Object.keys(categoryQueries[cat].replace(/\[|\]/g, '').split('='));
                            return poi.tags[tags[0]];
                        }) || 'attraction';

                        const dist = haversineDistance([lon, lat], [poiLon, poiLat]);

                        html += `
                            <div class="list-group-item list-group-item-action poi-list-item" data-poi-id="${poiId}">
                                <div class="d-flex w-100 justify-content-between">
                                    <h6 class="mb-1">${name}</h6>
                                    <small>${dist.toFixed(1)} km</small>
                                </div>
                                <div class="poi-category">${category}</div>
                            </div>`;
                        
                        const marker = L.marker([poiLat, poiLon], {
                            icon: L.divIcon({
                                className: 'poi-marker-icon',
                                html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32"><path fill="${categoryColors[category] || '#E56E7F'}" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5" fill="white"/></svg>`,
                                iconSize: [32, 32],
                                iconAnchor: [16, 32]
                            })
                        }).bindPopup(`<b>${name}</b><br>${category}`);
                        
                        marker.on('click', () => {
                            document.querySelectorAll('.poi-list-item').forEach(el => el.classList.remove('active'));
                            const listItem = document.querySelector(`.poi-list-item[data-poi-id="${poiId}"]`);
                            if(listItem) {
                                listItem.classList.add('active');
                                listItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }
                        });

                        poiLayer.addLayer(marker);
                        poiMarkers[poiId] = marker;
                    });
                    html += '</div>';
                }
            } catch (err) {
                console.error(`Failed to fetch POIs for ${allPlaces[i]}`, err);
            }
        }

        poiListContainer.innerHTML = allPOIsFound ? html : '<div class="text-center text-muted mt-3">No attractions found for the selected categories.</div>';
        
        document.querySelectorAll('.poi-list-item').forEach(item => {
            const poiId = item.dataset.poiId;
            const marker = poiMarkers[poiId];
            if (!marker) return;

            item.addEventListener('click', () => {
                map.setView(marker.getLatLng(), 15);
                marker.openPopup();
                document.querySelectorAll('.poi-list-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
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
                                const allPlaces = Array.from(locationsContainer.querySelectorAll('.location-input'))
                                    .map(i => i.value.trim()).filter(Boolean);
                                if (allPlaces.length >= 2) {
                                    calculateAndDisplayRoute();
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
    
    // --- Helpers ---
    function formatDuration(sec) {
        const h = Math.floor(sec / 3600);
        const m = Math.round((sec % 3600) / 60);
        return `${h}h ${m.toString().padStart(2, '0')}m`;
    }

    function haversineDistance(coords1, coords2) {
        const toRad = x => x * Math.PI / 180;
        const R = 6371; // Earth's radius in km

        const dLat = toRad(coords2[1] - coords1[1]);
        const dLon = toRad(coords2[0] - coords1[0]);
        const lat1 = toRad(coords1[1]);
        const lat2 = toRad(coords2[1]);

        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    // --- Initializer ---
    initializeLocations();
});
