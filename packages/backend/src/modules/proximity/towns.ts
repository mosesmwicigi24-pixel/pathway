// Offline town gazetteer for city-level pairing labels. A member's stored
// geohash center is snapped to the NEAREST town within SNAP_KM — fully
// deterministic, no external geocoding service, no coordinates ever exposed
// (the label is the town's name, not the member's position). Kenya is covered
// densely (Nuru Place's home ground) plus the East-African capitals and a few
// diaspora hubs; anywhere unmatched falls back to the coarse ≈lat,lng label.
import { haversineKm } from "./geo.js";

export interface Town {
  name: string;
  country: string; // ISO 3166-1 alpha-2
  lat: number;
  lng: number;
}

export const SNAP_KM = 40;

export const TOWNS: Town[] = [
  // Kenya — cities + major towns
  { name: "Nairobi", country: "KE", lat: -1.2864, lng: 36.8172 },
  { name: "Mombasa", country: "KE", lat: -4.0435, lng: 39.6682 },
  { name: "Kisumu", country: "KE", lat: -0.0917, lng: 34.768 },
  { name: "Nakuru", country: "KE", lat: -0.3031, lng: 36.08 },
  { name: "Eldoret", country: "KE", lat: 0.5143, lng: 35.2698 },
  { name: "Thika", country: "KE", lat: -1.0333, lng: 37.0693 },
  { name: "Machakos", country: "KE", lat: -1.5177, lng: 37.2634 },
  { name: "Kitengela", country: "KE", lat: -1.474, lng: 36.9615 },
  { name: "Naivasha", country: "KE", lat: -0.7172, lng: 36.4306 },
  { name: "Nyeri", country: "KE", lat: -0.4169, lng: 36.9514 },
  { name: "Meru", country: "KE", lat: 0.0463, lng: 37.6559 },
  { name: "Embu", country: "KE", lat: -0.5389, lng: 37.4596 },
  { name: "Kericho", country: "KE", lat: -0.3677, lng: 35.2831 },
  { name: "Kakamega", country: "KE", lat: 0.2827, lng: 34.7519 },
  { name: "Kisii", country: "KE", lat: -0.6817, lng: 34.7666 },
  { name: "Kitale", country: "KE", lat: 1.0157, lng: 35.0062 },
  { name: "Garissa", country: "KE", lat: -0.4536, lng: 39.6461 },
  { name: "Nanyuki", country: "KE", lat: 0.0167, lng: 37.0728 },
  { name: "Malindi", country: "KE", lat: -3.2192, lng: 40.1169 },
  { name: "Kilifi", country: "KE", lat: -3.6305, lng: 39.8499 },
  { name: "Voi", country: "KE", lat: -3.3945, lng: 38.5563 },
  { name: "Kajiado", country: "KE", lat: -1.8524, lng: 36.7768 },
  { name: "Narok", country: "KE", lat: -1.0921, lng: 35.8711 },
  { name: "Bungoma", country: "KE", lat: 0.5666, lng: 34.5606 },
  { name: "Busia", country: "KE", lat: 0.4633, lng: 34.1116 },
  { name: "Homa Bay", country: "KE", lat: -0.527, lng: 34.4571 },
  { name: "Migori", country: "KE", lat: -1.0635, lng: 34.4731 },
  { name: "Nyahururu", country: "KE", lat: 0.0421, lng: 36.3673 },
  { name: "Isiolo", country: "KE", lat: 0.3546, lng: 37.5822 },
  { name: "Lodwar", country: "KE", lat: 3.1191, lng: 35.5973 },
  { name: "Lamu", country: "KE", lat: -2.2717, lng: 40.902 },
  { name: "Wajir", country: "KE", lat: 1.7471, lng: 40.0573 },
  { name: "Marsabit", country: "KE", lat: 2.3346, lng: 37.9891 },
  { name: "Kapenguria", country: "KE", lat: 1.2389, lng: 35.1119 },
  { name: "Kerugoya", country: "KE", lat: -0.4989, lng: 37.2803 },
  { name: "Muranga", country: "KE", lat: -0.7839, lng: 37.04 },
  { name: "Ol Kalou", country: "KE", lat: -0.2645, lng: 36.3785 },
  { name: "Maralal", country: "KE", lat: 1.096, lng: 36.698 },
  // East Africa — capitals + major cities
  { name: "Kampala", country: "UG", lat: 0.3476, lng: 32.5825 },
  { name: "Entebbe", country: "UG", lat: 0.0512, lng: 32.4637 },
  { name: "Jinja", country: "UG", lat: 0.4244, lng: 33.2041 },
  { name: "Dar es Salaam", country: "TZ", lat: -6.7924, lng: 39.2083 },
  { name: "Dodoma", country: "TZ", lat: -6.163, lng: 35.7516 },
  { name: "Arusha", country: "TZ", lat: -3.3869, lng: 36.683 },
  { name: "Mwanza", country: "TZ", lat: -2.5164, lng: 32.9175 },
  { name: "Kigali", country: "RW", lat: -1.9441, lng: 30.0619 },
  { name: "Bujumbura", country: "BI", lat: -3.3614, lng: 29.3599 },
  { name: "Addis Ababa", country: "ET", lat: 9.0084, lng: 38.7648 },
  { name: "Juba", country: "SS", lat: 4.8517, lng: 31.5825 },
  { name: "Mogadishu", country: "SO", lat: 2.0469, lng: 45.3182 },
  { name: "Kinshasa", country: "CD", lat: -4.4419, lng: 15.2663 },
  { name: "Lusaka", country: "ZM", lat: -15.3875, lng: 28.3228 },
  { name: "Lagos", country: "NG", lat: 6.5244, lng: 3.3792 },
  { name: "Accra", country: "GH", lat: 5.6037, lng: -0.187 },
  { name: "Johannesburg", country: "ZA", lat: -26.2041, lng: 28.0473 },
  // Diaspora hubs
  { name: "London", country: "GB", lat: 51.5074, lng: -0.1278 },
  { name: "Dubai", country: "AE", lat: 25.2048, lng: 55.2708 },
  { name: "Doha", country: "QA", lat: 25.2854, lng: 51.531 },
  { name: "New York", country: "US", lat: 40.7128, lng: -74.006 },
  { name: "Dallas", country: "US", lat: 32.7767, lng: -96.797 },
  { name: "Minneapolis", country: "US", lat: 44.9778, lng: -93.265 },
];

/** Nearest gazetteer town within SNAP_KM of a point, or null. */
export function nearestTown(point: { lat: number; lng: number }): Town | null {
  let best: Town | null = null;
  let bestKm = SNAP_KM;
  for (const t of TOWNS) {
    const d = haversineKm(point, { lat: t.lat, lng: t.lng });
    if (d <= bestKm) {
      best = t;
      bestKm = d;
    }
  }
  return best;
}
