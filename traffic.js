'use strict';

require('dotenv').config({ path: './gmap_api.env' });

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// Define routes for each crossing
// Each route has origin/destination coordinates and a waypoint to force the specific crossing
const ROUTES = {
    'gwb-into': {
        origin: '40.8509,-73.9630',      // Fort Lee, NJ
        destination: '40.8500,-73.9400', // Washington Heights, Manhattan
        waypoint: '40.8517,-73.9527',    // GWB midpoint - forces route over bridge
        name: 'George Washington Bridge'
    },
    'gwb-out': {
        origin: '40.8500,-73.9400',      // Washington Heights, Manhattan
        destination: '40.8509,-73.9630', // Fort Lee, NJ
        waypoint: '40.8517,-73.9527',    // GWB midpoint
        name: 'George Washington Bridge'
    },
    'lincoln-into': {
        origin: '40.7600,-74.0200',      // Weehawken, NJ
        destination: '40.7580,-73.9900', // Midtown Manhattan
        waypoint: '40.7590,-74.0020',    // Lincoln Tunnel midpoint
        name: 'Lincoln Tunnel'
    },
    'lincoln-out': {
        origin: '40.7580,-73.9900',      // Midtown Manhattan
        destination: '40.7600,-74.0200', // Weehawken, NJ
        waypoint: '40.7590,-74.0020',    // Lincoln Tunnel midpoint
        name: 'Lincoln Tunnel'
    },
    'holland-into': {
        origin: '40.7280,-74.0500',      // Jersey City, NJ
        destination: '40.7260,-74.0070', // Lower Manhattan (Canal St)
        waypoint: '40.7267,-74.0110',    // Holland Tunnel midpoint
        name: 'Holland Tunnel'
    },
    'holland-out': {
        origin: '40.7260,-74.0070',      // Lower Manhattan (Canal St)
        destination: '40.7280,-74.0500', // Jersey City, NJ
        waypoint: '40.7267,-74.0110',    // Holland Tunnel midpoint
        name: 'Holland Tunnel'
    }
};

/**
 * Fetch travel time from Google Maps Directions API
 * Returns duration in minutes with traffic
 */
async function fetchTravelTime(crossingId) {
    const route = ROUTES[crossingId];
    if (!route) {
        throw new Error(`Unknown crossing: ${crossingId}`);
    }

    const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
    url.searchParams.set('origin', route.origin);
    url.searchParams.set('destination', route.destination);
    url.searchParams.set('waypoints', route.waypoint); // Force route through specific crossing
    url.searchParams.set('departure_time', 'now');
    url.searchParams.set('traffic_model', 'best_guess');
    url.searchParams.set('key', API_KEY);

    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.status !== 'OK') {
        console.error(`Google Maps API error for ${crossingId}:`, data.status, data.error_message);
        throw new Error(`API error: ${data.status}`);
    }

    if (!data.routes || data.routes.length === 0) {
        throw new Error('No routes found');
    }

    const route_data = data.routes[0];

    if (!route_data.legs || route_data.legs.length === 0) {
        throw new Error('No route legs found');
    }

    // Sum duration across all legs (waypoints create multiple legs)
    let totalDurationSeconds = 0;
    let totalDistanceMeters = 0;

    for (const leg of route_data.legs) {
        // Use duration_in_traffic if available, otherwise fall back to duration
        totalDurationSeconds += leg.duration_in_traffic
            ? leg.duration_in_traffic.value
            : leg.duration.value;
        totalDistanceMeters += leg.distance.value;
    }

    const durationMinutes = Math.round(totalDurationSeconds / 60);
    const distanceMiles = (totalDistanceMeters / 1609.34).toFixed(1);

    return {
        crossingId,
        waitTime: durationMinutes,
        durationText: `${durationMinutes} mins`,
        distance: `${distanceMiles} mi`,
        timestamp: new Date()
    };
}

/**
 * Fetch travel times for all crossings
 */
async function fetchAllTravelTimes() {
    const crossingIds = Object.keys(ROUTES);
    const results = [];

    for (const crossingId of crossingIds) {
        try {
            const result = await fetchTravelTime(crossingId);
            results.push(result);
        } catch (error) {
            console.error(`Failed to fetch ${crossingId}:`, error.message);
            results.push({
                crossingId,
                waitTime: null,
                error: error.message,
                timestamp: new Date()
            });
        }
    }

    return results;
}

/**
 * Check if API key is configured
 */
function isConfigured() {
    return !!API_KEY;
}

module.exports = {
    fetchTravelTime,
    fetchAllTravelTimes,
    isConfigured,
    ROUTES
};
