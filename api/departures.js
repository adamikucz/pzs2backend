const STOPS = [
  {
    id: "szymanowskiego-1",
    label: "Przystanek 1",
    url: "https://pszczyna.kiedyprzyjedzie.pl/api/departures/12369:30908"
  },
  {
    id: "szymanowskiego-2",
    label: "Przystanek 2",
    url: "https://pszczyna.kiedyprzyjedzie.pl/api/departures/12369:32430"
  }
];

function clean(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDeparture(row, directions = {}) {
  const directionId = String(row.direction_id || "");

  return {
    line: clean(row.line_name),
    time: clean(row.time),
    scheduledTime: clean(row.static_time),
    delayMinutes: Number(row.time_diff || 0),
    atStop: Boolean(row.at_stop),
    canceled: Boolean(row.canceled),
    estimated: Boolean(row.is_estimated),
    platform: clean(row.platform),
    direction: clean(directions[directionId] || ""),
    vehicleType: row.vehicle_type ?? null,
    tripId: row.trip_id ?? null
  };
}

async function fetchStop(stop) {
  const response = await fetch(stop.url, {
    headers: {
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`${stop.label}: HTTP ${response.status}`);
  }

  const data = await response.json();
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const directions = data.directions || {};

  return {
    id: stop.id,
    label: stop.label,
    stationName: clean(data.station_name || "Pszczyna ul. Szymanowskiego"),
    platform: clean(rows[0]?.platform || ""),
    timestamp: Number(data.timestamp || 0),
    departures: rows
      .map(row => normalizeDeparture(row, directions))
      .filter(row => row.line && row.time)
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    const results = await Promise.allSettled(STOPS.map(fetchStop));
    const stops = results
      .filter(result => result.status === "fulfilled")
      .map(result => result.value);

    const errors = results
      .filter(result => result.status === "rejected")
      .map(result => result.reason?.message || "Błąd pobierania przystanku");

    if (!stops.length) {
      return res.status(502).json({
        error: "Nie udało się pobrać odjazdów",
        errors
      });
    }

    res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=40");
    return res.status(200).json({
      updatedAt: Math.max(...stops.map(stop => stop.timestamp || 0)),
      stops,
      errors
    });
  } catch (err) {
    return res.status(500).json({
      error: "Błąd pobierania odjazdów",
      details: err.message
    });
  }
}
