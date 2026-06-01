import httpx
from core.config import settings


def decode_wmo(code: int) -> tuple:
    mapping = {
        0: ("Clear Sky", "☀️"),
        1: ("Mainly Clear", "🌤️"),
        2: ("Partly Cloudy", "⛅"),
        3: ("Overcast", "☁️"),
        45: ("Foggy", "🌫️"),
        48: ("Foggy", "🌫️"),
        51: ("Drizzle", "🌦️"),
        53: ("Drizzle", "🌦️"),
        55: ("Drizzle", "🌦️"),
        61: ("Rain", "🌧️"),
        63: ("Rain", "🌧️"),
        65: ("Rain", "🌧️"),
        71: ("Snow", "❄️"),
        73: ("Snow", "❄️"),
        75: ("Snow", "❄️"),
        77: ("Snow", "❄️"),
        80: ("Rain Showers", "🌦️"),
        81: ("Rain Showers", "🌦️"),
        82: ("Rain Showers", "🌦️"),
        85: ("Snow Showers", "🌨️"),
        86: ("Snow Showers", "🌨️"),
        95: ("Thunderstorm", "⛈️"),
        96: ("Heavy Thunderstorm", "⛈️"),
        99: ("Heavy Thunderstorm", "⛈️"),
    }
    return mapping.get(code, ("Unknown", "❓"))


def get_outfit_hint(code: int, temp_max: float, humidity: float) -> str:
    prefix = ""
    if code in (61, 63, 65, 80, 81, 82, 95, 96, 99):
        prefix = "rain expected, avoid white/light fabric, "
    elif code in (45, 48):
        prefix = "foggy morning, "

    if temp_max > 38:
        return prefix + "extreme heat, only loose breathable cotton/linen"
    elif 32 <= temp_max <= 38 and humidity > 70:
        return prefix + "humid heat, avoid dark or synthetic fabric"
    elif 32 <= temp_max <= 38:
        return prefix + "hot day, light breathable fabrics"
    elif 22 <= temp_max < 32:
        return prefix + "warm and comfortable, most fabrics fine"
    elif 15 <= temp_max < 22:
        return prefix + "mild, light layer recommended"
    else:
        return prefix + "cold, layering needed, jacket or sweater"


# Hour ranges for each time-of-day slot
TIME_SLOT_HOURS = {
    "morning":   (6, 12),
    "afternoon": (12, 17),
    "evening":   (17, 21),
    "night":     (21, 26),   # 21-02 next day, capped to available hours
    "full_day":  (6, 21),
}

# Maps the frontend time_of_day strings to slot keys
TIME_OF_DAY_TO_SLOT = {
    "Morning (6am–12pm)": "morning",
    "Morning (6am-12pm)": "morning",
    "Afternoon (12pm–5pm)": "afternoon",
    "Afternoon (12pm-5pm)": "afternoon",
    "Evening (5pm–9pm)": "evening",
    "Evening (5pm-9pm)": "evening",
    "Night (9pm+)": "night",
    "Full Day": "full_day",
}


def _safe_avg(values: list) -> float:
    nums = [v for v in values if v is not None]
    return round(sum(nums) / len(nums), 1) if nums else 0


def _safe_max(values: list) -> float:
    nums = [v for v in values if v is not None]
    return max(nums) if nums else 0


def _build_time_slots(hourly: dict, date_str: str) -> dict:
    """Extract time-slot averages from hourly data for one date."""
    times = hourly.get("time", [])
    slots = {}

    for slot_name, (h_start, h_end) in TIME_SLOT_HOURS.items():
        temps, humids, feels, rain_probs, uvs, wcodes = [], [], [], [], [], []

        for h in range(h_start, min(h_end, 24)):
            ts = f"{date_str}T{h:02d}:00"
            if ts not in times:
                continue
            idx = times.index(ts)

            temps.append(hourly.get("temperature_2m", [None])[idx])
            humids.append(hourly.get("relative_humidity_2m", [None])[idx])
            feels.append(hourly.get("apparent_temperature", [None])[idx])
            rain_probs.append(hourly.get("precipitation_probability", [None])[idx])
            uvs.append(hourly.get("uv_index", [None])[idx])
            wcodes.append(hourly.get("weathercode", [0])[idx])

        if not temps:
            continue

        dominant_wcode = max(set(wcodes), key=wcodes.count) if wcodes else 0
        label, emoji = decode_wmo(dominant_wcode)
        avg_temp = _safe_avg(temps)
        avg_humid = _safe_avg(humids)
        hint = get_outfit_hint(dominant_wcode, avg_temp, avg_humid)

        slots[slot_name] = {
            "avg_temp_c": avg_temp,
            "avg_humidity_pct": _safe_avg(humids),
            "avg_feels_like_c": _safe_avg(feels),
            "rain_prob_pct": round(_safe_max(rain_probs)),
            "uv_index": round(_safe_max(uvs), 1),
            "weather_code": dominant_wcode,
            "weather_label": label,
            "weather_emoji": emoji,
            "outfit_hint": hint,
        }

    return slots


async def reverse_geocode(lat: float, lng: float) -> dict:
    url = settings.GOOGLE_MAPS_GEOCODING_URL
    params = {
        "latlng": f"{lat},{lng}",
        "key": settings.GOOGLE_MAPS_API_KEY,
        "result_type": "locality|administrative_area_level_2|administrative_area_level_1|postal_code",
    }
    async with httpx.AsyncClient(timeout=10, verify=False) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()

    city, district, state, pin_code = "", "", "", ""
    if data.get("results"):
        for result in data["results"]:
            for comp in result.get("address_components", []):
                types = comp.get("types", [])
                if "locality" in types:
                    city = comp["long_name"]
                if "administrative_area_level_2" in types:
                    district = comp["long_name"]
                if "administrative_area_level_1" in types:
                    state = comp["long_name"]
                if "postal_code" in types:
                    pin_code = comp["long_name"]

    return {
        "lat": lat,
        "lng": lng,
        "city": city,
        "district": district,
        "state": state,
        "pin_code": pin_code,
    }


async def fetch_7day_forecast(lat: float, lng: float) -> list:
    params = {
        "latitude": lat,
        "longitude": lng,
        "daily": ",".join([
            "temperature_2m_max",
            "temperature_2m_min",
            "apparent_temperature_max",
            "apparent_temperature_min",
            "precipitation_probability_max",
            "precipitation_sum",
            "weathercode",
            "windspeed_10m_max",
            "uv_index_max",
            "relative_humidity_2m_max",
            "sunrise",
            "sunset",
        ]),
        "hourly": ",".join([
            "temperature_2m",
            "relative_humidity_2m",
            "apparent_temperature",
            "precipitation_probability",
            "weathercode",
            "uv_index",
        ]),
        "timezone": settings.DEFAULT_TIMEZONE,
        "forecast_days": settings.WEATHER_FORECAST_DAYS,
        "wind_speed_unit": settings.WIND_SPEED_UNIT,
        "temperature_unit": settings.TEMP_UNIT,
        "precipitation_unit": settings.PRECIPITATION_UNIT,
    }
    async with httpx.AsyncClient(timeout=15, verify=False) as client:
        resp = await client.get(settings.OPEN_METEO_BASE_URL, params=params)
        resp.raise_for_status()
        data = resp.json()

    daily = data.get("daily", {})
    hourly = data.get("hourly", {})
    dates = daily.get("time", [])
    forecasts = []

    for i, date_str in enumerate(dates):
        wcode = daily["weathercode"][i] if daily.get("weathercode") else 0
        temp_max = daily["temperature_2m_max"][i] if daily.get("temperature_2m_max") else 0
        humidity = daily["relative_humidity_2m_max"][i] if daily.get("relative_humidity_2m_max") else 0
        label, emoji = decode_wmo(wcode)
        hint = get_outfit_hint(wcode, temp_max, humidity)

        time_slots = _build_time_slots(hourly, date_str)

        forecasts.append({
            "date": date_str,
            "temp_max_c": temp_max,
            "temp_min_c": daily["temperature_2m_min"][i] if daily.get("temperature_2m_min") else 0,
            "feels_like_max_c": daily["apparent_temperature_max"][i] if daily.get("apparent_temperature_max") else 0,
            "feels_like_min_c": daily["apparent_temperature_min"][i] if daily.get("apparent_temperature_min") else 0,
            "humidity_pct": humidity,
            "rain_prob_pct": daily["precipitation_probability_max"][i] if daily.get("precipitation_probability_max") else 0,
            "rain_mm": daily["precipitation_sum"][i] if daily.get("precipitation_sum") else 0,
            "wind_kmh": daily["windspeed_10m_max"][i] if daily.get("windspeed_10m_max") else 0,
            "uv_index": daily["uv_index_max"][i] if daily.get("uv_index_max") else 0,
            "weather_code": wcode,
            "weather_label": label,
            "weather_emoji": emoji,
            "outfit_hint": hint,
            "time_slots": time_slots,
        })

    return forecasts
