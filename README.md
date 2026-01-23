# Commute Check

A real-time traffic monitoring web app for NYC crossings between Manhattan and New Jersey. Track wait times at the George Washington Bridge, Lincoln Tunnel, and Holland Tunnel.

## Features

- Real-time traffic data from Google Maps Directions API
- Historical heatmaps showing traffic patterns by day and hour
- SQLite database for storing traffic readings
- Rate limiting and admin authentication
- Responsive web interface

## Crossings Monitored

- George Washington Bridge (both directions)
- Lincoln Tunnel (both directions)
- Holland Tunnel (both directions)

## Prerequisites

- Node.js
- Google Maps API key with Directions API enabled

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `gmap_api.env` file with your Google Maps API key:
   ```
   GOOGLE_MAPS_API_KEY=your_api_key_here
   ADMIN_API_KEY=your_admin_key_here
   ```
4. Start the server:
   ```bash
   node app.js
   ```
5. Open http://localhost:3000 in your browser

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/crossings` | GET | Current traffic data for all crossings |
| `/api/crossings/:id/history` | GET | Historical heatmap data for a crossing |
| `/api/stats` | GET | Database statistics |
| `/api/readings` | POST | Add a manual reading (requires admin key) |
| `/api/refresh` | POST | Force refresh traffic data (requires admin key) |

## Configuration

The app runs on port 3000 by default. Traffic data is cached for 10 minutes and automatically refreshed.

Without a Google Maps API key, the app falls back to mock data for demonstration purposes.
