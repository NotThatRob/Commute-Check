'use strict';

require('dotenv').config({ path: './gmap_api.env' });

const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const db = require('./db');
const traffic = require('./traffic');

const app = express();
const PORT = 3000;

// Generate a random admin key on startup (displayed in console)
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || crypto.randomBytes(16).toString('hex');

// Rate limiters
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per window
    message: { error: 'Sorry, please wait a moment before trying again.' }
});

const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 requests per window for sensitive endpoints
    message: { error: 'Sorry, please wait a moment before trying again.' }
});

// Auth middleware for admin endpoints
function requireAdminKey(req, res, next) {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;

    if (!apiKey || apiKey !== ADMIN_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
    }
    next();
}

// Apply general rate limiting to all requests
app.use(generalLimiter);

// Limit JSON body size
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Crossing metadata
const CROSSINGS = [
    {
        id: 'gwb-into',
        name: 'George Washington Bridge',
        direction: 'Into Manhattan',
        area: 'Upper Manhattan',
        icon: '🌉'
    },
    {
        id: 'gwb-out',
        name: 'George Washington Bridge',
        direction: 'Out of Manhattan',
        area: 'To New Jersey',
        icon: '🌉'
    },
    {
        id: 'lincoln-into',
        name: 'Lincoln Tunnel',
        direction: 'Into Manhattan',
        area: 'Midtown',
        icon: '🚇'
    },
    {
        id: 'lincoln-out',
        name: 'Lincoln Tunnel',
        direction: 'Out of Manhattan',
        area: 'To New Jersey',
        icon: '🚇'
    },
    {
        id: 'holland-into',
        name: 'Holland Tunnel',
        direction: 'Into Manhattan',
        area: 'Lower Manhattan',
        icon: '🚗'
    },
    {
        id: 'holland-out',
        name: 'Holland Tunnel',
        direction: 'Out of Manhattan',
        area: 'To New Jersey',
        icon: '🚗'
    }
];

// Cache for current traffic data (refreshed every 10 minutes)
let trafficCache = {
    data: null,
    lastUpdated: null,
    refreshPromise: null // Prevents duplicate concurrent refreshes
};

const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Helper to get status from wait time
function getStatus(waitTime) {
    if (waitTime <= 15) {
        return { status: 'Light', statusClass: 'good' };
    } else if (waitTime <= 25) {
        return { status: 'Moderate', statusClass: 'moderate' };
    } else {
        return { status: 'Heavy', statusClass: 'heavy' };
    }
}

// Fetch fresh traffic data and update cache
async function refreshTrafficData() {
    console.log('Fetching fresh traffic data from Google Maps...');

    try {
        const results = await traffic.fetchAllTravelTimes();

        // Store readings in database
        for (const result of results) {
            if (result.waitTime !== null) {
                db.addReading(result.crossingId, result.waitTime, result.timestamp);
            }
        }

        // Update cache
        trafficCache = {
            data: results,
            lastUpdated: new Date()
        };

        console.log(`Traffic data updated at ${trafficCache.lastUpdated.toLocaleTimeString()}`);
        return results;
    } catch (error) {
        console.error('Failed to fetch traffic data:', error);
        throw error;
    }
}

// Get current traffic data (from cache or fresh)
async function getCurrentTraffic() {
    const now = Date.now();
    const cacheAge = trafficCache.lastUpdated
        ? now - trafficCache.lastUpdated.getTime()
        : Infinity;

    // Return cached data if fresh enough
    if (trafficCache.data && cacheAge < CACHE_TTL) {
        return trafficCache.data;
    }

    // If a refresh is already in progress, wait for it
    if (trafficCache.refreshPromise) {
        return await trafficCache.refreshPromise;
    }

    // Start a new refresh and store the promise
    trafficCache.refreshPromise = refreshTrafficData().finally(() => {
        trafficCache.refreshPromise = null;
    });

    return await trafficCache.refreshPromise;
}

// API endpoint for current crossing data
app.get('/api/crossings', async (req, res) => {
    try {
        if (!traffic.isConfigured()) {
            // Fall back to mock data if no API key
            console.log('No API key configured, using mock data');
            const data = CROSSINGS.map(crossing => {
                const delay = Math.floor(Math.random() * 31);
                const waitTime = 10 + delay;
                const { status, statusClass } = getStatus(waitTime);

                return {
                    ...crossing,
                    waitTime,
                    status,
                    statusClass,
                    updatedAt: new Date().toISOString()
                };
            });
            return res.json(data);
        }

        const trafficData = await getCurrentTraffic();

        const data = CROSSINGS.map(crossing => {
            const trafficResult = trafficData.find(t => t.crossingId === crossing.id);
            const waitTime = trafficResult?.waitTime ?? null;

            if (waitTime === null) {
                return {
                    ...crossing,
                    waitTime: '--',
                    status: 'Unknown',
                    statusClass: 'unknown',
                    updatedAt: trafficCache.lastUpdated?.toISOString() || new Date().toISOString(),
                    error: trafficResult?.error
                };
            }

            const { status, statusClass } = getStatus(waitTime);

            return {
                ...crossing,
                waitTime,
                status,
                statusClass,
                updatedAt: trafficCache.lastUpdated?.toISOString() || new Date().toISOString()
            };
        });

        res.json(data);
    } catch (error) {
        console.error('Error fetching crossings:', error);
        res.status(500).json({ error: 'Sorry, traffic data is temporarily unavailable.' });
    }
});

// API endpoint for historical heatmap data (from database)
app.get('/api/crossings/:id/history', (req, res) => {
    const crossingId = req.params.id;

    const validCrossing = CROSSINGS.find(c => c.id === crossingId);
    if (!validCrossing) {
        return res.status(400).json({ error: 'Invalid crossing ID' });
    }

    const data = db.getHistoricalData(crossingId);
    res.json(data);
});

// API endpoint to record a new reading manually (protected)
app.post('/api/readings', strictLimiter, requireAdminKey, (req, res) => {
    const { crossingId, waitTime } = req.body;

    // Validate crossingId
    if (!crossingId || typeof crossingId !== 'string') {
        return res.status(400).json({ error: 'crossingId is required and must be a string' });
    }

    const validCrossing = CROSSINGS.find(c => c.id === crossingId);
    if (!validCrossing) {
        return res.status(400).json({ error: 'Invalid crossingId' });
    }

    // Validate waitTime - must be a positive integer within reasonable bounds
    if (waitTime === undefined || waitTime === null) {
        return res.status(400).json({ error: 'waitTime is required' });
    }

    const waitTimeNum = Number(waitTime);
    if (!Number.isInteger(waitTimeNum) || waitTimeNum < 0 || waitTimeNum > 300) {
        return res.status(400).json({ error: 'waitTime must be an integer between 0 and 300 minutes' });
    }

    db.addReading(crossingId, waitTimeNum);
    res.json({ success: true });
});

// API endpoint to get database stats
app.get('/api/stats', (req, res) => {
    const stats = CROSSINGS.map(crossing => ({
        id: crossing.id,
        name: crossing.name,
        direction: crossing.direction,
        readingCount: db.getCount(crossing.id)
    }));

    res.json({
        crossings: stats,
        apiConfigured: traffic.isConfigured(),
        cacheAge: trafficCache.lastUpdated
            ? Math.round((Date.now() - trafficCache.lastUpdated.getTime()) / 1000)
            : null
    });
});

// Force refresh traffic data (protected)
app.post('/api/refresh', strictLimiter, requireAdminKey, async (req, res) => {
    try {
        await refreshTrafficData();
        res.json({ success: true, updatedAt: trafficCache.lastUpdated });
    } catch (error) {
        res.status(500).json({ error: 'Sorry, unable to refresh right now.' });
    }
});

// Start periodic traffic data fetching (every 10 minutes)
if (traffic.isConfigured()) {
    console.log('Google Maps API configured - will fetch real traffic data');

    // Fetch immediately on startup
    refreshTrafficData().catch(err => {
        console.error('Initial traffic fetch failed:', err.message);
    });

    // Then fetch every 10 minutes
    setInterval(() => {
        refreshTrafficData().catch(err => {
            console.error('Scheduled traffic fetch failed:', err.message);
        });
    }, CACHE_TTL);
} else {
    console.log('No Google Maps API key found - using mock data');
}

app.listen(PORT, () => {
    console.log(`Commute Check running at http://localhost:${PORT}`);
    console.log('Admin API key is configured.');
    console.log('(Set ADMIN_API_KEY in env file to use a persistent key)');
});
