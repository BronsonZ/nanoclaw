---
name: weather
description: >
  Fetch weather forecasts using the Open-Meteo API. Use whenever the user asks
  about weather, forecasts, current conditions, or temperature for any location.
  Also trigger for casual phrasing like "do I need an umbrella", "what's it like
  outside", or "weather this week".
---

# Weather Forecast via Open-Meteo

Fetch weather data from the Open-Meteo API (free, no API key required) and return a clean forecast.

## How to fetch

Use `WebFetch` to call the API. Always request these daily variables:

```
https://api.open-meteo.com/v1/forecast?latitude=LAT&longitude=LON&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max,winddirection_10m_dominant,sunset&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=TIMEZONE&forecast_days=7
```

Replace `LAT`, `LON`, and `TIMEZONE` with the target location's values. Use URL-encoded timezone (e.g., `America%2FChicago`).

If the user asks about a location not in the known list, use WebSearch to find its coordinates and timezone first.

## Known Locations

| Location | Latitude | Longitude | Timezone |
|----------|----------|-----------|----------|
| Seagrove Beach, FL (30A) | 30.3072 | -86.1444 | America/Chicago |
| Tyrone, GA (home) | 33.4726 | -84.5905 | America/New_York |

Add new locations to this table as the user requests them.

## WMO Weather Code

| Code | Condition |
|------|-----------|
| 0 | Clear sky |
| 1, 2, 3 | Mainly clear / Partly cloudy / Overcast |
| 45, 48 | Foggy |
| 51, 53, 55 | Light / Moderate / Dense drizzle |
| 61, 63, 65 | Slight / Moderate / Heavy rain |
| 71, 73, 75 | Slight / Moderate / Heavy snow |
| 80, 81, 82 | Slight / Moderate / Violent rain showers |
| 95 | Thunderstorm |
| 96, 99 | Thunderstorm with hail |

## Wind Direction

Convert degrees to cardinal: N=337.5-22.5, NE=22.5-67.5, E=67.5-112.5, SE=112.5-157.5, S=157.5-202.5, SW=202.5-247.5, W=247.5-292.5, NW=292.5-337.5.

## Output Format

Format results as a markdown table:

```
| Date        | High | Low  | Conditions    | Wind     | Rain | Sunset  |
|-------------|------|------|---------------|----------|------|---------|
| Thu, Mar 19 | 69°F | 46°F | Partly cloudy | N ~6 mph | None | 7:09 PM |
```

- Rain: `None` if 0-5%, otherwise show `X%`
- Sunset: convert ISO 8601 to 12-hour local time
- If the user didn't specify a location, default to Tyrone, GA (home)
