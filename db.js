'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'commute.db');
const db = new Database(dbPath);

// Initialize database schema
db.exec(`
    CREATE TABLE IF NOT EXISTS readings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        crossing_id TEXT NOT NULL,
        wait_time INTEGER NOT NULL,
        recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_readings_crossing ON readings(crossing_id);
    CREATE INDEX IF NOT EXISTS idx_readings_time ON readings(recorded_at);
`);

// Insert a new reading
const insertReading = db.prepare(`
    INSERT INTO readings (crossing_id, wait_time, recorded_at)
    VALUES (?, ?, ?)
`);

function addReading(crossingId, waitTime, timestamp = new Date()) {
    // Store in local time format for correct timezone display in heatmap
    const localTimestamp = timestamp.getFullYear() + '-' +
        String(timestamp.getMonth() + 1).padStart(2, '0') + '-' +
        String(timestamp.getDate()).padStart(2, '0') + ' ' +
        String(timestamp.getHours()).padStart(2, '0') + ':' +
        String(timestamp.getMinutes()).padStart(2, '0') + ':' +
        String(timestamp.getSeconds()).padStart(2, '0');
    return insertReading.run(crossingId, waitTime, localTimestamp);
}

// Get historical data for heatmap (aggregated by day of week and hour)
const getHeatmapData = db.prepare(`
    SELECT
        CAST(strftime('%w', recorded_at) AS INTEGER) as day_of_week,
        CAST(strftime('%H', recorded_at) AS INTEGER) as hour,
        ROUND(AVG(wait_time)) as avg_time,
        COUNT(*) as sample_count
    FROM readings
    WHERE crossing_id = ?
    GROUP BY day_of_week, hour
    ORDER BY day_of_week, hour
`);

function getHistoricalData(crossingId) {
    const rows = getHeatmapData.all(crossingId);

    // Convert to the format expected by the frontend
    const hours = [];
    for (let h = 0; h <= 23; h++) {
        hours.push(h);
    }

    const heatmap = [];

    // Reorder days to start with Monday (frontend expects Mon-Sun)
    const dayOrder = [1, 2, 3, 4, 5, 6, 0]; // Mon=1, Tue=2, ... Sun=0
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    dayOrder.forEach((dbDayIndex, displayIndex) => {
        hours.forEach(hour => {
            const row = rows.find(r => r.day_of_week === dbDayIndex && r.hour === hour);
            const displayHour = hour === 0 ? 12 : (hour > 12 ? hour - 12 : hour);
            const ampm = hour >= 12 ? 'pm' : 'am';
            heatmap.push({
                day: dayNames[displayIndex],
                dayIndex: displayIndex,
                hour,
                avgTime: row ? row.avg_time : null,
                sampleCount: row ? row.sample_count : 0,
                label: `${displayHour}${ampm}`
            });
        });
    });

    return { hours, days: dayNames, heatmap };
}

// Get the most recent reading for a crossing
const getLatestReading = db.prepare(`
    SELECT wait_time, recorded_at
    FROM readings
    WHERE crossing_id = ?
    ORDER BY recorded_at DESC
    LIMIT 1
`);

function getLatest(crossingId) {
    return getLatestReading.get(crossingId);
}

// Get reading count for a crossing
const getReadingCount = db.prepare(`
    SELECT COUNT(*) as count FROM readings WHERE crossing_id = ?
`);

function getCount(crossingId) {
    return getReadingCount.get(crossingId).count;
}

module.exports = {
    db,
    addReading,
    getHistoricalData,
    getLatest,
    getCount
};
